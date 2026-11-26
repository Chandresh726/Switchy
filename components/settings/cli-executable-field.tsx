"use client";

import { useEffect, useRef, useState } from "react";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { getApiErrorMessage } from "@/lib/api/error-presentation";

interface CLIExecutableFieldProps {
  id: string;
  command: string;
  value: string;
  onSave: (value: string) => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
}

export function CLIExecutableField({ id, command, value, onSave, onPendingChange }: CLIExecutableFieldProps) {
  const [draft, setDraft] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const save = useRef(onSave);
  useEffect(() => { save.current = onSave; }, [onSave]);
  useEffect(() => {
    onPendingChange?.(draft !== undefined);
    return () => onPendingChange?.(false);
  }, [draft, onPendingChange]);
  useEffect(() => {
    if (draft === undefined || saving || error) return;
    const snapshot = draft;
    const timer = setTimeout(() => {
      setSaving(true);
      void save.current(snapshot).then(() => {
        setDraft((current) => current === snapshot ? undefined : current);
      }).catch((cause: unknown) => {
        setError(getApiErrorMessage(cause, "Failed to save executable path"));
      }).finally(() => setSaving(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, saving, error]);

  return (
    <Field>
      <FieldLabel htmlFor={id}>Executable path</FieldLabel>
      <FieldDescription>Leave empty to use {command} from PATH. Changes save automatically.</FieldDescription>
      <InputGroup>
        <InputGroupInput id={id} value={draft ?? value} placeholder={`Use ${command} from PATH`}
          onChange={(event) => { setDraft(event.target.value); setError(undefined); }} />
        {saving ? <InputGroupAddon align="inline-end"><Loader2 className="animate-spin" />Saving</InputGroupAddon> : null}
      </InputGroup>
      {error ? <FieldError>{error} <Button variant="link" size="sm" onClick={() => setError(undefined)}>Retry</Button></FieldError> : null}
    </Field>
  );
}
