# Activity

The **Activity** tab is your full history: every plan payment, one-time buy, sale and transfer, newest first and grouped by day.

<!-- screenshot: the Activity tab with a row's details open -->

## Find something

- **Search**: type a name or a word, such as a plan name or a username.
- **Tabs**: narrow the list to one kind of activity.
- **Eye icon**: hide or show the amounts.
- **Load more**: at the bottom of the list, loads older activity.

| Tab               | Shows                                                               |
| ----------------- | ------------------------------------------------------------------- |
| **All**           | Everything.                                                         |
| **Transactions**  | One-time buys, sales, and sats you sent to or received from others. |
| **Subscriptions** | Your plan payments.                                                 |

If a search or tab finds nothing, you see **No matches**. Tap **Clear filters** to see everything again.

## Kinds of activity

| Entry                 | What it is                                                                     |
| --------------------- | ------------------------------------------------------------------------------ |
| **Membership Reward** | A plan payment and the bitcoin it bought. The plan's name is shown underneath. |
| **Bitcoin Purchase**  | A [one-time buy](buy-bitcoin.md).                                              |
| **Bitcoin Sale**      | A [sale](sell-sats.md) to your bank account, shown as **Sold to bank**.        |
| **Sent**              | Sats you [sent](send-sats.md) to another member.                               |
| **Received**          | Sats another member sent you. Lightning payments say **Lightning** underneath. |

Each row shows the amount in sats and its approximate value in rupees. Incoming amounts have a `+`, outgoing amounts a `−`.

The [wallet bot](bot-commands.md) can add other entries, such as **Tipjar**, **Faucet** or **Gift** transfers.

## See the details

Tap a row to open its details:

- **Status** and **Date**.
- **BTC received** or **BTC sent**.
- **Fee** for purchases, or **Network fee** for some transfers.
- **BTC price** at the time of a purchase.
- **Memo**, if the sender added a note.
- **Transaction ID**, with a button to copy it. Quote this ID if you contact support.

## What the status means

Entries that are not finished or did not go through have a coloured dot next to their name.

| Status         | Dot    | Meaning                                                                   |
| -------------- | ------ | ------------------------------------------------------------------------- |
| **Settled**    | None   | Paid, and the bitcoin is in your wallet.                                  |
| **Completed**  | None   | A transfer that went through.                                             |
| **Paid**       | None   | A sale whose rupees were sent to your bank.                               |
| **Processing** | Orange | Paid. The bitcoin is on its way to your wallet, or a sale is in progress. |
| **Pending**    | Orange | The payment has not been confirmed yet.                                   |
| **To approve** | Orange | A sale waiting for you to approve the payment.                            |
| **Cancelled**  | Grey   | The payment was cancelled. Nothing was added to your wallet.              |
| **Failed**     | Red    | The payment or transfer did not go through.                               |
| **Chargeback** | Red    | The payment was reversed by your bank.                                    |
| **Refunded**   | Red    | A sale whose sats were returned to your wallet.                           |

When a payment was cancelled, failed or reversed, or a sale was refunded, its sats amount is shown crossed out, because those sats never left or reached your wallet.

## If part of the list doesn't load

Your purchases and sales are loaded separately from your transfers. If one of them fails, the app still shows the other and says which part is missing, such as **Couldn't load transfers. Showing what loaded.** Tap **Try again**.
