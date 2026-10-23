/** AppKit cursor and key display hosted by macOS JavaScript for Automation. @module */

/**
 * Private newline-delimited JSON host for feedback and foreground pointer glides.
 * The display retains the current foreground key; complete text stays in the pending input sequence.
 * EOF ends its run loop.
 */
export const overlayScript = String.raw`
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.import('CoreText');
ObjC.bindFunction('CGEventKeyboardSetUnicodeString', ['void', ['void *', 'unsigned long', 'void *']]);
const application = $.NSApplication.sharedApplication;
application.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
application.finishLaunching;
const input = $.NSFileHandle.fileHandleWithStandardInput;
const output = $.NSFileHandle.fileHandleWithStandardOutput;
let running = true, buffered = '', motion = null, typing = null, activating = null, foregroundPid = 0, verifiedWindow = 0, pulse = 0, hideAt = 0, targetWindow = 0;
let location = { x: 0, y: 0 }, targetBounds = null, scrollDirection = null, scrollAt = 0, pressed = false, cursorVisible = false;
const bytes = $.NSMutableData.data;
function reply(value) {
  output.writeData($(JSON.stringify(value) + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
function panel(width, height) {
  const window = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(
    $.NSMakeRect(0, 0, width, height), $.NSWindowStyleMaskBorderless | $.NSWindowStyleMaskNonactivatingPanel,
    $.NSBackingStoreBuffered, false);
  window.opaque = false;
  window.backgroundColor = $.NSColor.clearColor;
  window.hasShadow = false;
  window.ignoresMouseEvents = true;
  window.hidesOnDeactivate = false;
  window.level = $.NSNormalWindowLevel;
  window.collectionBehavior = $.NSWindowCollectionBehaviorCanJoinAllSpaces | $.NSWindowCollectionBehaviorFullScreenAuxiliary;
  return window;
}
const cursor = panel(160, 160);
const image = $.NSImage.alloc.initWithSize($.NSMakeSize(160, 160));
image.lockFocus;
const arrow = $.NSBezierPath.bezierPath;
arrow.moveToPoint($.NSMakePoint(80, 80));
arrow.curveToPointControlPoint1ControlPoint2($.NSMakePoint(87, 57), $.NSMakePoint(78, 84), $.NSMakePoint(85, 55));
arrow.curveToPointControlPoint1ControlPoint2($.NSMakePoint(92, 66), $.NSMakePoint(89, 55), $.NSMakePoint(91, 63));
arrow.lineToPoint($.NSMakePoint(101, 71));
arrow.curveToPointControlPoint1ControlPoint2($.NSMakePoint(100, 76), $.NSMakePoint(106, 74), $.NSMakePoint(104, 75));
arrow.closePath;
$.NSGraphicsContext.saveGraphicsState;
const glow = $.NSShadow.alloc.init;
glow.shadowBlurRadius = 24;
glow.shadowOffset = $.NSMakeSize(0, 0);
glow.shadowColor = $.NSColor.colorWithCalibratedWhiteAlpha(0.15, 0.5);
glow.set;
$.NSColor.colorWithCalibratedWhiteAlpha(0.48, 0.95).setFill;
arrow.fill;
$.NSColor.colorWithCalibratedWhiteAlpha(1, 0.98).setStroke;
arrow.lineWidth = 2.5;
arrow.lineJoinStyle = $.NSRoundLineJoinStyle;
arrow.stroke;
$.NSGraphicsContext.restoreGraphicsState;
image.unlockFocus;
const imageView = $.NSImageView.alloc.initWithFrame($.NSMakeRect(0, 0, 160, 160));
imageView.image = image;
cursor.contentView.addSubview(imageView);
const pressedImage = image.copy;
pressedImage.lockFocus;
$.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.29, 0.52, 1, 1).setFill;
arrow.fill;
$.NSColor.whiteColor.setStroke;
arrow.stroke;
pressedImage.unlockFocus;
const ring = $.NSImageView.alloc.initWithFrame($.NSMakeRect(60, 60, 40, 40));
const ringImage = $.NSImage.alloc.initWithSize($.NSMakeSize(64, 64));
ringImage.lockFocus;
const circle = $.NSBezierPath.bezierPathWithOvalInRect($.NSMakeRect(2, 2, 60, 60));
$.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.29, 0.52, 1, 0.95).setStroke;
circle.lineWidth = 2;
circle.stroke;
ringImage.unlockFocus;
ring.image = ringImage;
ring.imageScaling = $.NSImageScaleAxesIndependently;
ring.hidden = true;
cursor.contentView.addSubview(ring);
let keyPanelWidth = 110;
const keys = panel(keyPanelWidth, 58);
const keyBackground = $.NSBox.alloc.initWithFrame($.NSMakeRect(0, 0, keyPanelWidth, 58));
keyBackground.boxType = $.NSBoxCustom;
keyBackground.borderType = $.NSNoBorder;
keyBackground.cornerRadius = 14;
keyBackground.fillColor = $.NSColor.colorWithCalibratedWhiteAlpha(0.12, 0.91);
keys.contentView.addSubview(keyBackground);
const keyboardIcon = $.NSImageView.alloc.initWithFrame($.NSMakeRect(16, 17, 28, 24));
keyboardIcon.image = $.NSImage.imageWithSystemSymbolNameAccessibilityDescription('keyboard', '');
keyboardIcon.contentTintColor = $.NSColor.whiteColor;
keys.contentView.addSubview(keyboardIcon);
const keycap = $.NSBox.alloc.initWithFrame($.NSMakeRect(56, 10, 38, 38));
keycap.boxType = $.NSBoxCustom; keycap.borderType = $.NSLineBorder; keycap.cornerRadius = 7;
keycap.borderColor = $.NSColor.colorWithCalibratedWhiteAlpha(1, 0.28);
keycap.fillColor = $.NSColor.colorWithCalibratedWhiteAlpha(1, 0.08);
keys.contentView.addSubview(keycap);
const keyFont = $.NSFont.monospacedSystemFontOfSizeWeight(23, $.NSFontWeightMedium);
const label = $.NSTextField.labelWithString('');
label.font = keyFont;
label.textColor = $.NSColor.whiteColor;
label.alignment = $.NSTextAlignmentCenter;
keys.contentView.addSubview(label);
function layoutKeys(text) {
  const attributes = $.NSDictionary.dictionaryWithObjectForKey(keyFont, $.NSFontAttributeName);
  const value = $.CFAttributedStringCreate(null, $(text), attributes);
  const line = $.CTLineCreateWithAttributedString(value);
  const ink = $.CTLineGetBoundsWithOptions(line, $.kCTLineBoundsUseGlyphPathBounds);
  const width = Math.max(38, Math.ceil(ink.size.width) + 24);
  keyPanelWidth = text ? width + 72 : 60;
  keys.setContentSize($.NSMakeSize(keyPanelWidth, 58));
  keyBackground.frame = $.NSMakeRect(0, 0, keyPanelWidth, 58);
  keycap.frame = $.NSMakeRect(56, 10, width, 38);
  keycap.hidden = !text; label.hidden = !text;
  label.stringValue = text;
  const labelHeight = label.fittingSize.height;
  label.frame = $.NSMakeRect(64, 0, width - 16, labelHeight);
  const baseline = label.lastBaselineOffsetFromBottom;
  label.frame = $.NSMakeRect(64, 29 - ink.origin.y - ink.size.height / 2 - baseline, width - 16, labelHeight);
  const height = $.NSScreen.screens.objectAtIndex(0).frame.size.height;
  if (targetBounds) keys.setFrameOrigin($.NSMakePoint(targetBounds.x + Math.max(0, (targetBounds.width - keyPanelWidth) / 2),
    height - targetBounds.y - targetBounds.height + 16));
}
const scrollPanel = panel(76, 46);
const scrollBackground = $.NSBox.alloc.initWithFrame($.NSMakeRect(0, 0, 76, 46));
scrollBackground.boxType = $.NSBoxCustom;
scrollBackground.borderType = $.NSNoBorder;
scrollBackground.cornerRadius = 12;
scrollBackground.fillColor = $.NSColor.colorWithCalibratedWhiteAlpha(0.12, 0.93);
scrollPanel.contentView.addSubview(scrollBackground);
const mouseImage = $.NSImage.alloc.initWithSize($.NSMakeSize(22, 30));
mouseImage.lockFocus;
const mouseOutline = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(2, 1, 18, 28), 8, 8);
$.NSColor.whiteColor.setStroke;
mouseOutline.lineWidth = 1.5;
mouseOutline.stroke;
mouseImage.unlockFocus;
const mouseView = $.NSImageView.alloc.initWithFrame($.NSMakeRect(12, 8, 22, 30));
mouseView.image = mouseImage;
scrollPanel.contentView.addSubview(mouseView);
const wheel = $.NSBox.alloc.initWithFrame($.NSMakeRect(22, 23, 3, 6));
wheel.boxType = $.NSBoxCustom;
wheel.borderType = $.NSNoBorder;
wheel.cornerRadius = 1.5;
wheel.fillColor = $.NSColor.whiteColor;
scrollPanel.contentView.addSubview(wheel);
const scrollArrow = $.NSTextField.labelWithString('');
scrollArrow.frame = $.NSMakeRect(42, 7, 28, 32);
scrollArrow.font = $.NSFont.systemFontOfSizeWeight(24, $.NSFontWeightMedium);
scrollArrow.textColor = $.NSColor.whiteColor;
scrollPanel.contentView.addSubview(scrollArrow);
function show() {
  if (targetWindow && cursorVisible) cursor.orderWindowRelativeTo($.NSWindowAbove, targetWindow);
}
const keyCodes = { a:0,s:1,d:2,f:3,h:4,g:5,z:6,x:7,c:8,v:9,b:11,q:12,w:13,e:14,r:15,y:16,t:17,
  '1':18,'2':19,'3':20,'4':21,'6':22,'5':23,'=':24,'9':25,'7':26,'-':27,'8':28,'0':29,']':30,o:31,u:32,'[':33,
  i:34,p:35,return:36,l:37,j:38,"'":39,k:40,';':41,'\\':42,',':43,'/':44,n:45,m:46,'.':47,tab:48,
  space:49,[String.fromCharCode(96)]:50,delete:51,escape:53,cmd:55,shift:56,alt:58,ctrl:59,fn:63,
  f17:64,f18:79,f19:80,f20:90,f5:96,f6:97,f7:98,f3:99,f8:100,f9:101,f11:103,f13:105,f16:106,
  f14:107,f10:109,f12:111,f15:113,home:115,pageup:116,forwarddelete:117,f4:118,end:119,f2:120,
  pagedown:121,f1:122,left:123,right:124,down:125,up:126 };
const modifierFlags = { cmd:1048576,shift:131072,alt:524288,ctrl:262144,fn:8388608 };
function front(pid) {
  const application = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (application.isNil() || !application.active) {
    const error = new Error('The target application lost input focus. Observe before continuing.');
    error.code = 'FOCUS_CHANGED'; throw error;
  }
  if (verifiedWindow) verifyWindow(pid, verifiedWindow);
}
function verifyWindow(pid, windowId) {
  const raw = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0);
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject(raw));
  const first = windows.find(window => window.kCGWindowOwnerPID === pid && window.kCGWindowLayer === 0);
  if (!first || first.kCGWindowNumber !== windowId) {
    const error = new Error('The exact observed window is not the target process foreground window.');
    error.code = 'FOCUS_CHANGED'; throw error;
  }
}
function dragEvent(type) {
  const event = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(location.x, location.y), 0);
  $.CGEventSetFlags(event, 0);
  $.CGEventPost(0, event);
}
function releaseDrag() {
  if (motion && motion.dragging) { dragEvent(2); pressed = false; }
}
function chord(value) {
  const names = value.keys, base = names[names.length - 1], code = keyCodes[base];
  if (code === undefined || names.slice(0, -1).some(key => modifierFlags[key] === undefined)) {
    const error = new Error('Unsupported foreground key combination.');
    error.code = 'INVALID_KEY'; throw error;
  }
  front(value.pid);
  let flags = 0;
  const modifiers = names.slice(0, -1);
  const post = (key, down, mask) => {
    const event = $.CGEventCreateKeyboardEvent(null, keyCodes[key], down);
    $.CGEventSetFlags(event, mask); $.CGEventPost(0, event);
  };
  for (const key of modifiers) {
    flags |= modifierFlags[key]; post(key, true, flags);
  }
  try {
    post(base, true, flags | (modifierFlags[base] || 0));
    post(base, false, flags);
  } finally {
    for (const key of modifiers.slice().reverse()) {
      flags &= ~modifierFlags[key]; post(key, false, flags);
    }
  }
}
function command(value) {
  if (value.action === 'cancel') {
    releaseDrag();
    typing = null; motion = null;
    reply({ error: 'Input canceled.', code: 'CANCELED' });
  } else if (value.action === 'activate') {
    const target = $.NSRunningApplication.runningApplicationWithProcessIdentifier(value.pid);
    if (target.isNil() || !target.activateWithOptions($.NSApplicationActivateIgnoringOtherApps)) {
      reply({ id: value.id, code: 'FOCUS_UNAVAILABLE', error: 'The exact target process could not be activated.' });
    } else {
      foregroundPid = value.pid; verifiedWindow = 0;
      // Foreground clicks and native drags can raise the receiving window after dispatch.
      for (const display of [cursor, keys, scrollPanel]) display.level = $.NSPopUpMenuWindowLevel + 1;
      activating = { id: value.id, target };
    }
  } else if (value.action === 'verify_window') {
    try {
      front(value.pid);
      verifyWindow(value.pid, value.windowId); verifiedWindow = value.windowId;
      reply({ id: value.id });
    } catch (error) { reply({ id: value.id, error: String(error), code: error.code }); }
  } else if (value.action === 'click') {
    try {
      front(value.pid);
      const button = value.button === 'right' ? 1 : 0;
      for (let click = 1; click <= value.count; click++) {
        for (const down of [true, false]) {
          const type = button ? down ? 3 : 4 : down ? 1 : 2;
          const event = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(value.x, value.y), button);
          $.CGEventSetFlags(event, 0);
          $.CGEventSetIntegerValueField(event, 1, click);
          $.CGEventPost(0, event);
        }
      }
      reply({ id: value.id });
    } catch (error) { reply({ id: value.id, error: String(error), code: error.code }); }
  } else if (value.action === 'key') {
    try { chord(value); reply({ id: value.id }); }
    catch (error) { reply({ id: value.id, error: String(error), code: error.code }); }
  } else if (value.action === 'type') {
    typing = { id: value.id, pid: value.pid, characters: value.characters, index: 0, delay: value.delayMs, next: Date.now() };
  } else if (value.action === 'target') {
    targetWindow = value.windowId; targetBounds = value.bounds;
    cursorVisible = false;
    cursor.orderOut(null); keys.orderOut(null); scrollPanel.orderOut(null);
    reply({ id: value.id });
  } else if (value.action === 'drag') {
    try {
      front(value.pid);
      location = { x: value.from.x, y: value.from.y };
      motion = { id: value.id, pid: value.pid, start: value.from, x: value.to.x, y: value.to.y,
        at: Date.now(), duration: value.durationMs, idleMs: value.idleMs, dragging: true };
      pressed = true; hideAt = 0;
      dragEvent(1);
      show();
    } catch (error) {
      releaseDrag(); motion = null;
      reply({ id: value.id, error: String(error), code: error.code });
    }
  } else if (value.action === 'move') {
    cursorVisible = value.visible;
    keys.orderOut(null);
    scrollDirection = null; scrollPanel.orderOut(null);
    targetWindow = value.windowId; targetBounds = value.bounds;
    if (!targetBounds) throw new Error('An exact window rectangle is required');
    if (value.physical) {
      const pointer = $.NSEvent.mouseLocation;
      location = { x: pointer.x, y: $.NSScreen.screens.objectAtIndex(0).frame.size.height - pointer.y };
    } else if (!location.x && !location.y) location = { x: value.x, y: value.y };
    motion = { id: value.id, start: { x: location.x, y: location.y }, x: value.x, y: value.y, at: Date.now(), duration: value.durationMs, idleMs: value.idleMs, physical: value.physical };
    hideAt = Date.now() + value.durationMs + value.idleMs;
    if (value.visible) show();
  } else if (value.action === 'feedback') {
    if (value.pressed !== undefined) pressed = value.pressed;
    hideAt = value.hold || pressed ? 0 : Date.now() + value.idleMs;
    if (value.click) { pulse = Date.now(); keys.orderOut(null); scrollDirection = null; scrollPanel.orderOut(null); }
    if (value.scroll) {
      scrollDirection = value.scroll; scrollAt = Date.now();
      scrollArrow.stringValue = { up: '↑', down: '↓', left: '←', right: '→' }[value.scroll];
      keys.orderOut(null);
      if (targetWindow) scrollPanel.orderWindowRelativeTo($.NSWindowAbove, targetWindow);
    }
    if (value.label || value.typing) {
      scrollDirection = null; scrollPanel.orderOut(null);
      layoutKeys(value.typing ? value.key || '' : value.label);
      const height = $.NSScreen.screens.objectAtIndex(0).frame.size.height;
      if (targetBounds) {
        keys.setFrameOrigin($.NSMakePoint(targetBounds.x + Math.max(0, (targetBounds.width - keyPanelWidth) / 2), height - targetBounds.y - targetBounds.height + 16));
        keys.orderWindowRelativeTo($.NSWindowAbove, targetWindow);
      }
    }
    show();
    reply({ id: value.id });
  } else if (value.action === 'hide') {
    motion = null;
    cursor.orderOut(null);
    keys.orderOut(null); scrollPanel.orderOut(null); scrollDirection = null;
    reply({ id: value.id });
  } else if (value.action === 'close') {
    releaseDrag(); motion = null; typing = null;
    running = false;
    reply({ id: value.id });
  }
}
reply({ ready: true });
while (running) {
  const data = input.availableData;
  if (Number(data.length) === 0) break;
  bytes.appendData(data);
  const decoded = $.NSString.alloc.initWithDataEncoding(bytes, $.NSUTF8StringEncoding);
  if (decoded.isNil()) continue;
  buffered += ObjC.unwrap(decoded);
  bytes.setLength(0);
  let end;
  while ((end = buffered.indexOf('\n')) >= 0) {
    const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
    if (line) command(JSON.parse(line));
  }
  const now = Date.now();
  if (activating && activating.target.active) {
    reply({ id: activating.id }); activating = null;
  }
  if (typing && now >= typing.next) {
    try {
      front(typing.pid);
      if (typing.index >= typing.characters.length) {
      reply({ id: typing.id }); typing = null;
    } else {
      const text = typing.characters[typing.index++];
      const lineBreak = text === '\n' || text === '\r' || text === '\r\n';
      if (lineBreak) chord({ pid: typing.pid, keys: ['shift', 'return'] });
      else {
        const data = $(text).dataUsingEncoding($.NSUTF16LittleEndianStringEncoding);
        const code = keyCodes[text.toLowerCase()] === undefined ? 0 : keyCodes[text.toLowerCase()];
        for (const down of [true, false]) {
          const event = $.CGEventCreateKeyboardEvent(null, code, down);
          $.CGEventSetFlags(event, 0);
          $.CGEventKeyboardSetUnicodeString(event, text.length, data.bytes);
          $.CGEventPost(0, event);
        }
      }
      const names = { '\n': '↵', '\r': '↵', '\t': '⇥', ' ': '␣' };
      const key = lineBreak ? '⇧  ↵' : names[text] || text;
      layoutKeys(key);
      reply({ id: typing.id, key });
      typing.next = now + typing.delay;
      }
    } catch (error) {
      reply({ id: typing.id, error: String(error), code: error.code }); typing = null;
    }
  }
  if (motion) {
    const moving = motion;
    try {
      if (moving.dragging) front(moving.pid);
      if (moving.releasing) {
        releaseDrag(); motion = null; pulse = now;
        hideAt = now + moving.idleMs;
        reply({ id: moving.id });
      } else {
      const progress = moving.duration === 0 ? 1 : Math.min(1, (now - moving.at) / moving.duration);
      const eased = progress * progress * (3 - 2 * progress);
      location = { x: moving.start.x + (moving.x - moving.start.x) * eased, y: moving.start.y + (moving.y - moving.start.y) * eased };
      if (moving.dragging) {
        dragEvent(6);
        reply({ id: moving.id, point: { x: location.x, y: location.y, at: Date.now() } });
      } else if (moving.physical) {
        const event = $.CGEventCreateMouseEvent(null, 5, $.CGPointMake(location.x, location.y), 0);
        $.CGEventPost(0, event);
      }
      if (progress === 1) {
        if (moving.dragging) moving.releasing = true;
        else {
          motion = null; hideAt = now + moving.idleMs;
          reply({ id: moving.id });
        }
      }
      }
    } catch (error) {
      releaseDrag(); motion = null;
      reply({ id: moving.id, error: String(error), code: error.code });
    }
  }
  const height = $.NSScreen.screens.objectAtIndex(0).frame.size.height;
  cursor.setFrameOrigin($.NSMakePoint(location.x - 80, height - location.y - 80));
  if (scrollDirection && targetBounds) {
    const right = location.x + 40;
    const side = right + 76 <= targetBounds.x + targetBounds.width - 8 ? right : location.x - 84;
    const left = Math.max(targetBounds.x + 8, Math.min(targetBounds.x + targetBounds.width - 84, side));
    const top = Math.max(targetBounds.y + 8, Math.min(targetBounds.y + targetBounds.height - 54, location.y - 7));
    scrollPanel.setFrameOrigin($.NSMakePoint(left, height - top - 46));
    const phase = ((now - scrollAt) % 650) / 650;
    const dx = scrollDirection === 'left' ? -4 : scrollDirection === 'right' ? 4 : 0;
    const dy = scrollDirection === 'up' ? 5 : scrollDirection === 'down' ? -5 : 0;
    wheel.setFrameOrigin($.NSMakePoint(22 + dx * phase, 23 + dy * phase));
    wheel.alphaValue = 1 - phase * 0.8;
  }
  const age = (now - pulse) / 450;
  imageView.image = pressed || age >= 0 && age <= 1 ? pressedImage : image;
  ring.hidden = age < 0 || age > 1;
  if (!ring.hidden) {
    const size = 16 + 54 * age;
    ring.frame = $.NSMakeRect(80 - size / 2, 80 - size / 2, size, size);
    ring.alphaValue = 1 - age;
  }
  if (hideAt && now > hideAt) { cursor.orderOut(null); keys.orderOut(null); scrollPanel.orderOut(null); hideAt = 0; }
  if (foregroundPid && !$.NSRunningApplication.runningApplicationWithProcessIdentifier(foregroundPid).active) {
    cursor.orderOut(null); keys.orderOut(null); scrollPanel.orderOut(null);
  }
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(1 / 60));
}
releaseDrag();
cursor.orderOut(null);
keys.orderOut(null);
scrollPanel.orderOut(null);
`
