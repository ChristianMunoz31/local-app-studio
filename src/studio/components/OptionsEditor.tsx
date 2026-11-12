import { useId, useState } from 'react';
import type { SpecIssue } from '@local-app-studio/runtime/spec/schema';
import { formErrorClass, inputClass, labelClass } from '@/components/shared/formStyles.js';

interface Props {
  options: string[];
  onChange(next: string[]): void;
  issues?: SpecIssue[];
}

const parse = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

const NEWLINE = String.fromCharCode(10);

/** One choice per line. Lines are trimmed and empty lines are dropped. */
export default function OptionsEditor({ options, onChange, issues = [] }: Props) {
  const id = useId();
  const [text, setText] = useState(options.join(NEWLINE));
  const [seen, setSeen] = useState(options);
  if (seen !== options) {
    // An outside change (not the one this editor just made) replaces the text.
    setSeen(options);
    const now = parse(text);
    if (!(now.length === options.length && now.every((o, i) => o === options[i]))) setText(options.join(NEWLINE));
  }

  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        Choices (one per line)
      </label>
      <textarea
        id={id}
        className={inputClass}
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parse(e.target.value));
        }}
        aria-invalid={issues.length > 0 ? true : undefined}
      />
      {issues.map((issue, i) => (
        <p key={`${issue.path}:${i}`} className={formErrorClass}>
          {issue.message}
        </p>
      ))}
    </div>
  );
}
