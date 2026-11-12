// The baked spec of a runtime build (virtual:app-spec, served by studioUiPlugin). Its own module so that only a
// runtime build ever asks for the virtual id: src/modules/runtime.jsx imports this file dynamically in runtime mode,
// and tests mock this file instead of the virtual id (Vitest cannot resolve it).
export { default } from 'virtual:app-spec';
