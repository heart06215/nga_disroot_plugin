#import <Foundation/Foundation.h>
#import <WebKit/WebKit.h>

@interface NgaExtBridge : NSObject <WKScriptMessageHandler>
+ (instancetype)shared;
@end
