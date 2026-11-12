// Where "Build it yourself" lands when the helper cannot answer: tables come first, so an app with none starts on Data.
import type { AppSpec } from '@local-app-studio/runtime/spec/schema';
import type { StepId } from './steps';

export const BUILD_IN_DESIGN = 'Build it yourself in Design';
export const BUILD_ON_DATA = 'Build it yourself, starting with tables on Data';
export const NO_HELPER_IN_DESIGN = `No helper? ${BUILD_IN_DESIGN}`;
export const NO_HELPER_ON_DATA = `No helper? ${BUILD_ON_DATA}`;
export const START_ON_DATA = 'Start with your tables on Data.';
export const GO_TO_DATA = 'Go to Data';

/** The step "Build it yourself" opens: Data for an app with no tables, else Design. */
export const buildYourselfStep = (spec: AppSpec): StepId => (spec.tables.length === 0 ? 'data' : 'design');

/** The button words for that step. */
export const buildYourselfLabel = (spec: AppSpec, noHelper = false): string =>
  spec.tables.length === 0 ? (noHelper ? NO_HELPER_ON_DATA : BUILD_ON_DATA) : noHelper ? NO_HELPER_IN_DESIGN : BUILD_IN_DESIGN;
