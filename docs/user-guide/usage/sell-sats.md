# Sell sats

Selling turns sats from your wallet into rupees, paid into your bank account.

{% hint style="info" %}
Two things must be in place first: a [verified identity](../setup/verify-your-identity.md) and a [verified bank account](../setup/add-a-bank-account.md). If either is missing, the Sell screen shows a notice that takes you there.
{% endhint %}

## Steps

1. On the **Wallet** tab, tap **Sell**. The **Sell bitcoin** sheet opens.
2. Enter the amount. You can type it in sats under **You sell**, or tap the swap button to type the rupees you want under **You receive**. The quick buttons sell **25%**, **50%** or **75%** of your sats, or **All** (**Max** when a sale limit is lower than your balance).
3. Tap **Review**. The app gets a quote: a rate that is held for you for a short time.
4. Check **Review sale**.
5. **Press and hold** the **Press and Hold to Sell** button until it completes.
6. [Approve the payment](#approve-the-payment) from your wallet.

<!-- screenshot: the "Review sale" sheet with the countdown -->

## How much you can sell

Under the amount, the app says **You have … sats movable**. Tap the ⓘ to see **Your balance** split into:

- **Movable**: sats you can sell or send now.
- **In savings pots**: sats locked in pots you set up in the wallet bot. They can't be sold until you withdraw them from the pot in the bot. **Manage pots in the bot** opens it.
- **Being sent**: sats held by a payment that hasn't finished yet.

There is a minimum amount per sale, and there may be a maximum. The line at the bottom shows the rate, the fee and any bank charge.

## The quote

**Review sale** shows **You receive** in large type, and a countdown, **Rate held for 0:24**, while the rate is locked.

| Row             | Meaning                                                |
| --------------- | ------------------------------------------------------ |
| **You sell**    | The sats leaving your wallet.                          |
| **Value**       | What those sats are worth before charges.              |
| **Fee**         | The fee, as a percentage and in rupees.                |
| **Bank charge** | A fixed charge for the bank transfer, if there is one. |
| **Rate**        | The bitcoin price used for this sale.                  |
| **Paid to**     | The bank and account number receiving the money.       |

If the countdown runs out, you see **Rate expired. Refresh to continue**. Tap **Refresh** for a new rate. Nothing is sold until you press and hold.

## Approve the payment

After you press and hold, the sats still have to be paid from your wallet. The sale shows **Approve the payment**, with a countdown of how long you have left.

- Tap **Pay … sats** to pay from the app. In a browser, your device asks for your [passkey](../setup/passkey.md) first.
- Or tap **Open the bot chat** and tap **✅ Pay** on the bot's message.
- Tap **Cancel sale** if you changed your mind. Nothing is sold.

If you don't approve in time, the sale is cancelled and nothing is sold. For a large sale above your daily allowance, the app says **Confirm in the bot chat**: tap **Confirm** on the bot's message to finish.

{% hint style="warning" %}
A sale cannot be undone once the payment is approved. Check the amount and the bank account before you press and hold.
{% endhint %}

## After you approve

The sale updates by itself as it moves along. You can close the sheet with **Close** (the sale keeps going) and follow it later with **We'll keep going. Track this sale**.

| You see                      | What is happening                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Selling your sats**        | The sats are being taken from your wallet. This only takes a moment.                                                  |
| **Sending LKR to your bank** | Your sats are sold and the bank transfer is on its way.                                                               |
| **LKR sent**                 | Done. The rupees were sent to your bank account.                                                                      |
| **Returning your sats**      | The bank transfer could not be made, so your sats are being returned to your wallet.                                  |
| **Sale cancelled**           | The bank transfer could not be made and your sats were returned.                                                      |
| **Nothing sold**             | The sale expired before it went through. Get a new quote to sell.                                                     |
| **Checking your sale**       | The app lost its connection while you confirmed. It checks whether the sale went through, which takes up to a minute. |
| **We're checking this sale** | Something took longer than expected. The team is checking and will contact you.                                       |

The sale page also lists the amount, sats sold, value, fee, bank charge, rate, date, a short **Reference**, and a **Bank reference** once the transfer is made. Quote the reference if you need to contact support.

If you see **We're checking this sale**, do not sell again until it is resolved.

## Recent sales

Every sale appears in the **Activity** tab as a **Bitcoin Sale**. When you open a sale's page (with **View sale** or **We'll keep going. Track this sale**), the back arrow takes you to **Sell sats**, which lists your last ten sales under **Recent sales**, each with a status:

| Badge          | Meaning                                    |
| -------------- | ------------------------------------------ |
| **To approve** | Waiting for you to approve the payment.    |
| **Processing** | The sale is in progress.                   |
| **Paid**       | The rupees were sent to your bank.         |
| **Refunding**  | Your sats are being returned.              |
| **Refunded**   | Your sats were returned.                   |
| **Checking**   | The team is reviewing the sale.            |
| **Expired**    | The quote ran out before it was confirmed. |

Tap a sale to open its page.
