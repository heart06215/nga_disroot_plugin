#import "NgaExtBridge.h"

static NSString *const kNgaExtHandler = @"ngaext";

@interface NgaExtBridge ()
- (BOOL)isAllowedURL:(NSURL *)url;
- (void)sendToWebView:(WKWebView *)webView cbId:(NSString *)cbId response:(NSDictionary *)response;
@end

@implementation NgaExtBridge

+ (instancetype)shared {
    static NgaExtBridge *shared = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ shared = [[NgaExtBridge alloc] init]; });
    return shared;
}

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.name isEqualToString:kNgaExtHandler]) return;
    NSDictionary *body = [message.body isKindOfClass:[NSDictionary class]] ? message.body : nil;
    NSString *cbId = body[@"cbId"];
    NSString *urlString = body[@"url"];
    if (![cbId isKindOfClass:[NSString class]] || ![urlString isKindOfClass:[NSString class]]) return;

    NSURL *url = [NSURL URLWithString:urlString];
    if (![self isAllowedURL:url]) {
        [self sendToWebView:message.webView cbId:cbId response:@{@"ok": @NO, @"error": @"不支持的链接域名"}];
        return;
    }

    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url
                                                       cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                                   timeoutInterval:25.0];
    [req setValue:@"JSONHttpRequest" forHTTPHeaderField:@"X-Requested-With"];
    [req setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    [req setValue:@"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                   @"AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        forHTTPHeaderField:@"User-Agent"];

    __weak NgaExtBridge *weakSelf = self;
    NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:req
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NgaExtBridge *strongSelf = weakSelf;
            if (!strongSelf) return;
            if (error) {
                [strongSelf sendToWebView:message.webView cbId:cbId
                           response:@{@"ok": @NO, @"error": error.localizedDescription ?: @"网络错误"}];
                return;
            }
            NSHTTPURLResponse *http = [response isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse *)response : nil;
            if (http && http.statusCode != 200) {
                [strongSelf sendToWebView:message.webView cbId:cbId
                           response:@{@"ok": @NO, @"error": [NSString stringWithFormat:@"HTTP %ld", (long)http.statusCode]}];
                return;
            }
            if (data.length > 8 * 1024 * 1024) {
                [strongSelf sendToWebView:message.webView cbId:cbId response:@{@"ok": @NO, @"error": @"响应过大"}];
                return;
            }
            NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            if (!text.length) {
                [strongSelf sendToWebView:message.webView cbId:cbId response:@{@"ok": @NO, @"error": @"空响应"}];
                return;
            }
            if ([text hasPrefix:@"\uFEFF"]) text = [text substringFromIndex:1];
            NSString *trimmed = [text stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
            if (![trimmed hasPrefix:@"{"]) {
                [strongSelf sendToWebView:message.webView cbId:cbId
                           response:@{@"ok": @NO, @"error": @"站点返回了非 PrivateBin 内容（可能正在维护或被拦截）"}];
                return;
            }
            [strongSelf sendToWebView:message.webView cbId:cbId response:@{@"ok": @YES, @"body": text}];
        }];
    [task resume];
}

- (BOOL)isAllowedURL:(NSURL *)url {
    if (!url) return NO;
    NSString *scheme = url.scheme.lowercaseString;
    if (![scheme isEqualToString:@"https"] && ![scheme isEqualToString:@"http"]) return NO;
    NSString *host = url.host.lowercaseString;
    if (!host.length) return NO;
    if ([host isEqualToString:@"bin.disroot.org"]) return YES;
    if ([host isEqualToString:@"paste.disroot.org"]) return YES;
    if ([host hasSuffix:@".disroot.org"]) return YES;
    if ([host isEqualToString:@"paste.to"]) return YES;
    return NO;
}

- (void)sendToWebView:(WKWebView *)webView cbId:(NSString *)cbId response:(NSDictionary *)response {
    if (!webView) return;
    NSData *data = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
    if (!data) return;
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSArray *args = @[cbId ?: @"", json ?: @"{}"];
    NSData *argsData = [NSJSONSerialization dataWithJSONObject:args options:0 error:nil];
    if (!argsData) return;
    NSString *argsString = [[NSString alloc] initWithData:argsData encoding:NSUTF8StringEncoding];
    NSString *js = [NSString stringWithFormat:@"window.__ngaext&&window.__ngaext.onResult.apply(null,%@);", argsString];
    dispatch_async(dispatch_get_main_queue(), ^{
        [webView evaluateJavaScript:js completionHandler:^(id result, NSError *error) {
            if (error) NSLog(@"[ngaext] onResult error: %@", error);
        }];
    });
}

@end
