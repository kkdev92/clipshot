/**
 * Schema-driven configuration for ClipShot
 *
 * Mirrors package.json's contributes.configuration one-to-one, so the keys,
 * their types and their defaults are declared once. `assertManifestMatches`
 * in the test suite is what keeps the two halves honest.
 *
 * Numeric ranges are deliberately NOT declared here: a schema violation falls
 * back to the default value, whereas sanitizeConfiguration() clamps the value
 * into range, which stays closer to what the user asked for (e.g. a
 * jpegQuality of 200 becomes 100, not 80). Range checking therefore remains
 * the job of the validators module.
 *
 * Dotted keys are the ones package.json declares. VS Code resolves them
 * against the section, so `read().values['fileName.pattern']` reads
 * `clipshot.fileName.pattern`.
 */

import {
  defineSettings,
  setting,
  type SettingSpec,
  type ValidationResult,
} from '@kkdev92/vscode-ext-kit';

import { CONFIG_PREFIX, DEFAULTS } from '../core/constants';
import { sanitizeConfiguration } from './validators';
import type { ExtensionConfig } from '../core/types';

/**
 * An integer that may also be null.
 *
 * `setting.integer` cannot express this and neither can the other builders,
 * but `SettingSpec` is an ordinary interface — the type is what package.json
 * declares (`["integer", "null"]` collapses to `integer` for the manifest
 * check) and `validate` is the whole of the rule.
 */
function nullableInteger(defaultValue: number | null): SettingSpec<number | null> {
  return {
    type: 'integer',
    default: defaultValue,
    scope: 'window',
    validate: (value): ValidationResult<number | null> => {
      if (value === null) {
        return { ok: true, value: null };
      }
      return typeof value === 'number' && Number.isInteger(value)
        ? { ok: true, value }
        : { ok: false, issues: [{ message: 'expected an integer or null' }] };
    },
  };
}

/** One of a fixed set of strings, or null for "not set". */
function nullableEnum<const TValues extends readonly [string, ...string[]]>(
  values: TValues,
  defaultValue: TValues[number] | null
): SettingSpec<TValues[number] | null> {
  return {
    type: 'string',
    default: defaultValue,
    scope: 'window',
    enum: [null, ...values] as readonly (TValues[number] | null)[],
    validate: (value): ValidationResult<TValues[number] | null> => {
      if (value === null) {
        return { ok: true, value: null };
      }
      return typeof value === 'string' && (values as readonly string[]).includes(value)
        ? { ok: true, value: value as TValues[number] }
        : { ok: false, issues: [{ message: `expected one of ${values.join(', ')}, or null` }] };
    },
  };
}

/** Every `clipshot.*` setting, and the token its accessor is injected under. */
export const Settings = defineSettings({
  section: CONFIG_PREFIX,
  values: {
    enabled: setting.boolean({ default: DEFAULTS.ENABLED }),
    logLevel: setting.enum({
      values: ['trace', 'debug', 'info', 'warn', 'error', 'silent'],
      default: DEFAULTS.LOG_LEVEL,
    }),
    saveDirectory: setting.string({ default: DEFAULTS.SAVE_DIRECTORY }),
    'fileName.pattern': setting.string({ default: DEFAULTS.FILE_NAME_PATTERN }),
    'fileName.sequenceDigits': setting.integer({ default: DEFAULTS.SEQUENCE_DIGITS }),
    'output.format': setting.enum({
      values: ['png', 'jpeg', 'webp'],
      default: DEFAULTS.OUTPUT_FORMAT,
    }),
    'output.jpegQuality': setting.integer({ default: DEFAULTS.JPEG_QUALITY }),
    'output.webpQuality': setting.integer({ default: DEFAULTS.WEBP_QUALITY }),
    'resize.mode': setting.enum({ values: ['off', 'fit'], default: DEFAULTS.RESIZE_MODE }),
    'resize.maxWidth': nullableInteger(DEFAULTS.RESIZE_MAX_WIDTH),
    'resize.maxHeight': nullableInteger(DEFAULTS.RESIZE_MAX_HEIGHT),
    'resize.preset': nullableEnum(['ai-optimized'], DEFAULTS.RESIZE_PRESET),
    'insert.format': setting.enum({
      values: ['auto', 'path', 'markdown', 'html'],
      default: DEFAULTS.INSERT_FORMAT,
    }),
    'insert.altSource': setting.enum({
      values: ['filename', 'literal'],
      default: DEFAULTS.ALT_SOURCE,
    }),
    'insert.altLiteral': setting.string({ default: DEFAULTS.ALT_LITERAL }),
    'limits.maxFileSizeMB': setting.integer({ default: DEFAULTS.MAX_FILE_SIZE_MB }),
    'notifications.level': setting.enum({
      values: ['all', 'errors', 'none'],
      default: DEFAULTS.NOTIFICATION_LEVEL,
    }),
  },
});

/** The accessor `Settings.token` resolves to. */
export type SettingsAccessor = {
  read(): { readonly values: Readonly<Record<string, unknown>> };
};

/**
 * Reads every setting into the one nested object the rest of the extension
 * works with.
 *
 * Flat-to-nested is a shape change, not a policy: the manifest is flat because
 * VS Code's settings editor is, and the code is nested because that is how the
 * paste pipeline reads. Values arrive already validated (an invalid one having
 * fallen back to its default) and are then clamped into their documented
 * ranges.
 *
 * @example
 * ```ts
 * const current = loadConfiguration(settings);
 * ```
 */
export function loadConfiguration(settings: {
  read(): { readonly values: Readonly<Record<string, unknown>> };
}): ExtensionConfig {
  const v = settings.read().values as {
    enabled: boolean;
    logLevel: ExtensionConfig['logLevel'];
    saveDirectory: string;
    'fileName.pattern': string;
    'fileName.sequenceDigits': number;
    'output.format': ExtensionConfig['output']['format'];
    'output.jpegQuality': number;
    'output.webpQuality': number;
    'resize.mode': ExtensionConfig['resize']['mode'];
    'resize.maxWidth': number | null;
    'resize.maxHeight': number | null;
    'resize.preset': ExtensionConfig['resize']['preset'];
    'insert.format': ExtensionConfig['insert']['format'];
    'insert.altSource': ExtensionConfig['insert']['altSource'];
    'insert.altLiteral': string;
    'limits.maxFileSizeMB': number;
    'notifications.level': ExtensionConfig['notifications']['level'];
  };

  const raw: ExtensionConfig = {
    enabled: v.enabled,
    logLevel: v.logLevel,
    saveDirectory: v.saveDirectory,
    fileName: {
      pattern: v['fileName.pattern'],
      sequenceDigits: v['fileName.sequenceDigits'],
    },
    output: {
      format: v['output.format'],
      jpegQuality: v['output.jpegQuality'],
      webpQuality: v['output.webpQuality'],
    },
    resize: {
      mode: v['resize.mode'],
      maxWidth: v['resize.maxWidth'],
      maxHeight: v['resize.maxHeight'],
      preset: v['resize.preset'],
    },
    insert: {
      format: v['insert.format'],
      altSource: v['insert.altSource'],
      altLiteral: v['insert.altLiteral'],
    },
    limits: {
      maxFileSizeMB: v['limits.maxFileSizeMB'],
    },
    notifications: {
      level: v['notifications.level'],
    },
  };

  return { ...raw, ...sanitizeConfiguration(raw) } as ExtensionConfig;
}
