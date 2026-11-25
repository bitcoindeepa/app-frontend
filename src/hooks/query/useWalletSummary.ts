"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useSession } from "@/hooks/useSession";
import fetchy from "@/lib/fetchy";
import type { DCSummary } from "@/lib/types";

export const walletSummaryOptions = () =>
  queryOptions({
    queryKey: queryKeys.walletSummary,
    queryFn: () => fetchy.get<DCSummary>("/transaction/dca-summary"),
    // Matches the backend's 10 s cache: the wallet balance and savings pots
    // change in the bot, so reopening or refocusing the app should refetch
    staleTime: 10_000,
  });

export function useWalletSummary() {
  const isAuthed = useSession().status === "authenticated";
  return useQuery({ ...walletSummaryOptions(), enabled: isAuthed });
}
