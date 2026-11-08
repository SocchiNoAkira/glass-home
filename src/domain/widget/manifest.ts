export interface WidgetManifest {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: 1;
  readonly name: string;
  readonly description: string;
  readonly entry: string;
  readonly icon: string;
  readonly defaultSize: readonly [number, number];
  readonly sizes: {
    readonly presets: readonly (readonly [number, number])[];
    readonly minW: number;
    readonly minH: number;
    readonly maxW: number;
    readonly maxH: number;
  };
  readonly minHostVersion: string;
  readonly permissions?: {
    readonly networkDomains?: readonly string[];
    readonly capabilities?: readonly ('notifications' | 'bookmarks' | 'geolocation')[];
  };
  readonly settingsSchema?: Readonly<Record<string, unknown>>;
  readonly refreshPolicy?: {
    readonly visibleIntervalSeconds?: number;
    readonly backgroundIntervalMinutes?: number;
  };
  readonly locales?: readonly string[];
  readonly author?: string;
  readonly homepage?: string;
}
