"use client";

import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { List, ListRow, Section } from "@/components/ui/section";
import { useToast } from "@/components/ui/toast";
import { useAddPasskey, usePasskeyStatus, useRemovePasskey } from "@/hooks/query/usePasskey";
import { passkeyCancelled, passkeyErrorMessage } from "@/lib/passkey";
import { haptic, usePlatform } from "@/platform";
import { Icon } from "./icons";

/**
 * Passkey lock settings. Web/PWA: add passkeys (the first one turns the
 * lock on), see and remove them (removing the last turns it off). Inside
 * Telegram passkeys can't run, so it points to Telegram's own passcode lock.
 */
export function PasskeySection() {
  const platform = usePlatform();
  const toast = useToast();
  const { data } = usePasskeyStatus();
  const add = useAddPasskey();
  const remove = useRemovePasskey();

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
