#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import "NgaExtBridge.h"

static char kNgaExtConfiguredKey;

static NSString *NgaExtJS(void) {
    NSArray<NSString *> *paths = @[
        @"/var/jb/Library/Application Support/NgaExt/ngaext.js",
        @"/Library/Application Support/NgaExt/ngaext.js"
    ];
    for (NSString *path in paths) {
        NSString *js = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
        if (js.length > 0) return js;
    }
    NSLog(@"[ngaext] ngaext.js not found");
    return @"";
}

%hook WKWebView

- (instancetype)initWithFrame:(CGRect)frame configuration:(WKWebViewConfiguration *)configuration {
    @try {
        if (configuration) {
            WKUserContentController *ucc = configuration.userContentController;
            if (!ucc) {
                ucc = [[WKUserContentController alloc] init];
                configuration.userContentController = ucc;
            }
            if (!objc_getAssociatedObject(configuration, &kNgaExtConfiguredKey)) {
                objc_setAssociatedObject(configuration, &kNgaExtConfiguredKey, @YES,
                                         OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                [ucc removeScriptMessageHandlerForName:@"ngaext"];
                [ucc addScriptMessageHandler:[NgaExtBridge shared] name:@"ngaext"];
                NSString *js = NgaExtJS();
                if (js.length > 0) {
                    WKUserScript *script = [[WKUserScript alloc]
                        initWithSource:js
                        injectionTime:WKUserScriptInjectionTimeAtDocumentEnd
                        forMainFrameOnly:NO];
                    [ucc addUserScript:script];
                }
            }
        }
    } @catch (NSException *e) {
        NSLog(@"[ngaext] setup failed: %@", e);
    }
    return %orig;
}

%end
