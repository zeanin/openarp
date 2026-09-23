let cachedModule: any = null;

/**
 * Dynamically loads the ESM-only @earendil-works/pi-coding-agent package.
 * Ensures seamless interoperability across both CommonJS and ESM runtimes without ERR_PACKAGE_PATH_NOT_EXPORTED.
 */
export async function loadPiCodingAgent(): Promise<any> {
  if (!cachedModule) {
    cachedModule = await import('@earendil-works/pi-coding-agent');
  }
  return cachedModule;
}
