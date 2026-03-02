interface Window {
  _backstopTools: any;
  _readyEvent: string;
  _defined: boolean;
  _selectorExpansion: boolean;
  _backstopSelectors: string[];
  _backstopSelectorsExp: string[];
  _backstopSelectorsExpMap: Record<string, { exists: number; isVisible: boolean }>;
  _styleData: string;
  backstopTools: any;
}
