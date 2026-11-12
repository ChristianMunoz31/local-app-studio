// The app_state key prefix of the helper's waiting design (`studio.waiting.<appId>`). It lives outside server/studio/ so
// the export and import code, which ship in every build, can name it without pulling Studio code into a runtime build.
export const WAITING_KEY_PREFIX = 'studio.waiting.';
