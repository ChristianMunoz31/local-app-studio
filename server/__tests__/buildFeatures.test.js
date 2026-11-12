// server/buildFeatures.js: which optional features this build contains.
import { describe, expect, it } from 'vitest';
import {
  CLOUD_AI_MODES,
  FeatureUnavailableError,
  featureUnavailableBody,
  getCloudAiBuild,
  isCloudAiInBuild,
  isFeatureInBuild,
  resolveBuildCloudAi,
} from '../buildFeatures.js';
import { PUBLIC_BUILD } from './helpers/proBuild.js';

describe('resolveBuildCloudAi (build scripts)', () => {
  it.each([
    [undefined, 'on'],
    ['', 'on'],
    ['   ', 'on'],
    ['on', 'on'],
    ['off', 'off'],
    [' off ', 'off'],
  ])('reads %j as %s', (value, expected) => {
    expect(resolveBuildCloudAi({ APP_CLOUD_AI: value })).toBe(expected);
  });

  it.each(['OFF', 'On', '0', 'false', 'no', 'of'])('throws on %j', (value) => {
    expect(() => resolveBuildCloudAi({ APP_CLOUD_AI: value })).toThrow(`APP_CLOUD_AI must be one of on, off (got "${value}")`);
  });

  it('uses the label in the message', () => {
    expect(() => resolveBuildCloudAi({ APP_CLOUD_AI: 'x' }, '--cloud-ai')).toThrow('--cloud-ai must be one of on, off (got "x")');
  });

  it('knows the two modes', () => {
    expect([...CLOUD_AI_MODES]).toEqual(['on', 'off']);
  });
});

describe.skipIf(PUBLIC_BUILD)('getCloudAiBuild (running server) (needs the cloud provider, which is not in a public build)', () => {
  it('unbundled: unset, empty and on are on; anything else is off', () => {
    expect(getCloudAiBuild({}, undefined)).toBe('on');
    expect(getCloudAiBuild({ APP_CLOUD_AI: '' }, undefined)).toBe('on');
    expect(getCloudAiBuild({ APP_CLOUD_AI: 'on' }, undefined)).toBe('on');
    expect(getCloudAiBuild({ APP_CLOUD_AI: 'off' }, undefined)).toBe('off');
    expect(getCloudAiBuild({ APP_CLOUD_AI: 'OFF' }, undefined)).toBe('off');
    expect(getCloudAiBuild({ APP_CLOUD_AI: 'typo' }, undefined)).toBe('off');
  });

  it('bundled: the define wins over the environment, both ways', () => {
    expect(getCloudAiBuild({ APP_CLOUD_AI: 'on' }, 'off')).toBe('off');
    expect(getCloudAiBuild({ APP_CLOUD_AI: 'off' }, 'on')).toBe('on');
    expect(getCloudAiBuild({}, 'off')).toBe('off');
    expect(getCloudAiBuild({}, 'garbage')).toBe('off');
  });

  it('isCloudAiInBuild and isFeatureInBuild follow it; only cloudAi can be missing', () => {
    expect(isCloudAiInBuild({ APP_CLOUD_AI: 'off' }, undefined)).toBe(false);
    expect(isCloudAiInBuild({}, undefined)).toBe(true);
    expect(isFeatureInBuild('cloudAi', { APP_CLOUD_AI: 'off' }, undefined)).toBe(false);
    for (const id of ['aiLan', 'updates', 'license']) expect(isFeatureInBuild(id, { APP_CLOUD_AI: 'off' }, undefined)).toBe(true);
  });
});

describe.skipIf(!PUBLIC_BUILD)('getCloudAiBuild in a public build (runs only in a public build, which has no cloud provider)', () => {
  it('is off whatever the environment or the bundle says', () => {
    for (const env of [{}, { APP_CLOUD_AI: 'on' }, { APP_CLOUD_AI: 'off' }]) {
      for (const bundled of [undefined, 'on', 'off']) {
        expect(getCloudAiBuild(env, bundled)).toBe('off');
        expect(isCloudAiInBuild(env, bundled)).toBe(false);
        expect(isFeatureInBuild('cloudAi', env, bundled)).toBe(false);
      }
    }
  });
});

describe('the unavailable-feature contract', () => {
  it('has the documented body', () => {
    expect(featureUnavailableBody('cloudAi')).toEqual({
      error: 'feature_unavailable',
      code: 'feature_unavailable',
      feature: 'cloudAi',
      message: 'This build contains no cloud provider.',
    });
  });

  it('a pro part has its own sentence, in the body and in the error', () => {
    const helper = 'The helper is not in this build. Build it yourself in Design.';
    expect(featureUnavailableBody('helper')).toEqual({ error: 'feature_unavailable', code: 'feature_unavailable', feature: 'helper', message: helper });
    expect(new FeatureUnavailableError('helper')).toMatchObject({ feature: 'helper', status: 403, message: helper });
    expect(new FeatureUnavailableError('installer').message).toBe('Making an installer is not in this build. Export the app instead.');
    expect(new FeatureUnavailableError('unknown').message).toBe('This build contains no cloud provider.');
  });

  it('FeatureUnavailableError carries status, feature and body', () => {
    const err = new FeatureUnavailableError('cloudAi');
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ name: 'FeatureUnavailableError', status: 403, feature: 'cloudAi', message: 'This build contains no cloud provider.' });
    expect(err.body).toEqual(featureUnavailableBody('cloudAi'));
  });
});
