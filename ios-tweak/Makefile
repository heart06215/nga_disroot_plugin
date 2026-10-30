TARGET = iphone:clang:latest:15.0
ARCHS = arm64 arm64e
INSTALL_TARGET_PROCESSES = NGA

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = NgaExt
NgaExt_FILES = Tweak.xm NgaExtBridge.m
NgaExt_CFLAGS = -fobjc-arc
NgaExt_FRAMEWORKS = Foundation UIKit WebKit
NgaExt_LIBRARIES = substrate

include $(THEOS_MAKE_PATH)/tweak.mk

# 把可编辑的 JS 源同步进 deb 的安装目录
before-package::
	@mkdir -p "layout/Library/Application Support/NgaExt"
	@cp ngaext.js "layout/Library/Application Support/NgaExt/ngaext.js"
