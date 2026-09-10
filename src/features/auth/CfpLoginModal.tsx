import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Modal, ModalActions } from "../../components/ui";
import { useAuth } from "./AuthProvider";

export function CfpLoginModal({
  open,
  onCancel,
  onSignedIn,
}: {
  open: boolean;
  onCancel(): void;
  onSignedIn(): void;
}) {
  const auth = useAuth();
  const emailInput = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const submitting = auth.status === "submitting";

  useEffect(() => {
    if (!open) return;
    auth.clearError();
    setPassword("");
    queueMicrotask(() => emailInput.current?.focus());
  }, [open]);

  if (!open) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await auth.login(email.trim(), password)) onSignedIn();
    else setPassword("");
  }

  return (
    <Modal title="Sign in with CFP" titleId="admin-dialog-title">
      <form onSubmit={(event) => void submit(event)}>
        <p className="mb-4 text-sm leading-relaxed text-muted">
          Tour Hub administration is available to CFP tour hosts, moderators, developers, and administrators.
        </p>
        <Field htmlFor="cfp-email" label="Email">
          <Input
            ref={emailInput}
            id="cfp-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !submitting) onCancel();
            }}
          />
        </Field>
        <Field htmlFor="cfp-password" label="Password">
          <Input
            id="cfp-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !submitting) onCancel();
            }}
          />
        </Field>
        {auth.error ? <Alert tone="danger">{auth.error}</Alert> : null}
        <ModalActions>
          <Button variant="success" type="submit" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <Button disabled={submitting} onClick={onCancel}>Cancel</Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
