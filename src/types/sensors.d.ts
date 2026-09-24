// Browser APIs that are missing from lib.dom.d.ts or only exist in some engines.

type PermissionResult = 'granted' | 'denied' | 'default';

/** Static side of DeviceOrientationEvent / DeviceMotionEvent on iOS 13+ Safari. */
interface SensorPermissionApi {
  /** Must be called from a user gesture. */
  requestPermission?: () => Promise<PermissionResult>;
}

interface DeviceOrientationEvent {
  /** iOS Safari: compass heading in degrees clockwise from magnetic north. */
  readonly webkitCompassHeading?: number;
  readonly webkitCompassAccuracy?: number;
}

interface WindowEventMap {
  /** Chromium on Android: orientation relative to the Earth's frame. */
  deviceorientationabsolute: DeviceOrientationEvent;
}

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorOptions {
  formats?: string[];
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<string[]>;
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
