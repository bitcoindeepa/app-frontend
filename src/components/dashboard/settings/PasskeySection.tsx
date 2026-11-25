"use client";

import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { List, ListRow, Section } from "@/components/ui/section";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  useAddPasskey,
  usePasskeyStatus,
  useRemovePasskey,
  useSetLockOnOpen,
} from "@/hooks/query/usePasskey";
import { locksOnOpen } from "@/lib/app-lock";
import { passkeyCancelled, passkeyErrorMessage } from "@/lib/passkey";
import { haptic, usePlatform } from "@/platform";
import { Icon } from "./icons";

/**
 * Passkey lock settings. Web/PWA: add passkeys (the first one turns the
 * lock on), see and remove them (removing the last turns it off), and choose
 * whether the app asks for the passkey when it opens (on by default; sends
 * and sale payments ask either way). Inside
 * Telegram passkeys can't run, so it points to Telegram's own passcode lock.
 */
export function PasskeySection() {
  const platform = usePlatform();
  const toast = useToast();
  const { data } = usePasskeyStatus();
  const add = useAddPasskey();
  const remove = useRemovePasskey();
  const setLockOnOpen = useSetLockOnOpen();

  if (!data) return null;

  if (!data.available) {
    return (
      <Section title="App lock">
        <List>
          <ListRow
            icon={<Icon name="lock" className="text-ink2" />}
            title="Passkey lock"
            subtitle={
              data.enabled
                ? "On in the browser app. Inside Telegram, use Telegram's own passcode lock (Settings › Privacy and Security)."
                : "Passkeys work in the browser app. Inside Telegram, use Telegram's own passcode lock (Settings › Privacy and Security)."
            }
          />
        </List>
      </Section>
    );
  }

  const addPasskey = () => {
    haptic.impact("light");
    add.mutate(undefined, {
      onSuccess: () => {
        haptic.notify("success");
        toast({
          title: data.enabled ? "Passkey added" : "Passkey lock on",
          description: data.enabled
            ? undefined
            : "We'll ask for your passkey when you open the app.",
        });
      },
      onError: (e) => {
        if (passkeyCancelled(e)) return;
        haptic.notify("error");
        toast({
          type: "error",
          title: "Couldn't add the passkey",
          description: passkeyErrorMessage(e),
        });
      },
    });
  };

  const toggleLockOnOpen = (on: boolean) => {
    setLockOnOpen.mutate(on, {
      onSuccess: () => {
        haptic.notify("success");
        toast({
          title: on ? "We'll ask when you open the app" : "We won't ask when you open the app",
          description: on ? undefined : "Sending and selling still need your passkey.",
        });
      },
      onError: (e) => {
        if (passkeyCancelled(e)) return;
        haptic.notify("error");
        toast({
          type: "error",
          title: "Couldn't change it",
          description: passkeyErrorMessage(e),
        });
      },
    });
  };

  const removePasskey = async (id: string, name: string, last: boolean) => {
    const confirmed = await platform.confirm({
      title: `Remove ${name}?`,
      message: last
        ? "It's your only passkey, so the app will stop asking for one."
        : "You won't be able to unlock with it anymore.",
      confirmText: "Remove",
      destructive: true,
    });
    if (!confirmed) return;
    remove.mutate(id, {
      onSuccess: () => {
        haptic.notify("success");
        toast({ title: last ? "Passkey lock off" : "Passkey removed" });
      },
      onError: (e) => {
        haptic.notify("error");
        toast({ type: "error", title: "Couldn't remove it", description: passkeyErrorMessage(e) });
      },
    });
  };

  return (
    <Section title="App lock">
      <List>
        {data.passkeys.length === 0 ? (
          <ListRow
            icon={<Icon name="lock" className="text-ink2" />}
            title="Lock with a passkey"
            subtitle="Face ID, fingerprint or device PIN when you open the app"
            after={
              <Button size="sm" loading={add.isPending} onClick={addPasskey}>
                Set up
              </Button>
            }
          />
        ) : (
          <>
            <ListRow
              icon={<Icon name="lock" className="text-ink2" />}
              title="Ask when opening the app"
              subtitle="Sending and selling always ask"
              after={
                <Switch
                  label="Ask for your passkey when opening the app"
                  checked={setLockOnOpen.isPending ? setLockOnOpen.variables : locksOnOpen(data)}
                  disabled={setLockOnOpen.isPending}
                  onCheckedChange={toggleLockOnOpen}
                />
              }
            />
            {data.passkeys.map((passkey) => (
              <ListRow
                key={passkey.id}
                icon={<Icon name="lock" className="text-ink2" />}
                title={passkey.name}
                subtitle={
                  passkey.last_used_at
                    ? `Last used ${format(new Date(passkey.last_used_at), "d MMM yyyy")}`
                    : `Added ${format(new Date(passkey.created_at), "d MMM yyyy")}`
                }
                after={
                  <button
                    type="button"
                    aria-label={`Remove ${passkey.name}`}
                    disabled={remove.isPending}
                    onClick={() =>
                      void removePasskey(passkey.id, passkey.name, data.passkeys.length === 1)
                    }
                    className="press hit text-loss flex size-9 items-center justify-center rounded-full border-0 bg-transparent disabled:opacity-40"
                  >
                    <Icon name="trash" />
                  </button>
                }
              />
            ))}
            <ListRow
              onClick={add.isPending ? undefined : addPasskey}
              icon={<Icon name="plus" className="text-link" />}
              title={<span className="text-link">Add another passkey</span>}
            />
          </>
        )}
      </List>
    </Section>
  );
}
