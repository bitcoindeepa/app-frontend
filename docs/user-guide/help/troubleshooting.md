# Troubleshooting

## Opening and signing in

### "Session expired"

Inside Telegram, your session with the app has run out. Close Bitcoin Deepa and open it again from the bot.

### "Couldn't sign you in with Telegram"

This appears in a web browser when the Telegram sign-in did not complete. Tap **Sign in with Telegram** again and approve the request. If it keeps failing, tap **Prefer Telegram?** to use the Mini App instead.

Other messages you might see on the sign-in screen:

- **Login was cancelled**: you closed the Telegram window. Try again when you're ready.
- **That login link expired**: the sign-in took too long. Try again.
- **Too many attempts**: wait a minute, then try again.

### "Open this in Telegram"

The page was opened in a way that needs Telegram. Tap **Open in Telegram**.

### "Taking longer than usual…"

Your connection is slow. Wait a moment, or tap **Retry**.

### "You're offline"

The app could not reach the internet. You can still see the last data it loaded, but payments are paused. Reconnect and pull down to refresh.

### My wallet is empty, but I have used the app before

You are probably signed in with a different Telegram account. Your wallet belongs to the account you first used. Sign in with that one.

## Passkey and app lock

### "Bitcoin Deepa is locked"

The passkey lock is on. Tap **Unlock with passkey** and approve with Face ID, your fingerprint or your device PIN.

### I lost the device with my passkey

On the locked screen, tap **Can't use your passkey?**, then **Message support**. Once the team has checked it's you, they remove the lost passkey and you can add a new one. You can also tap **Log out** and sign in again with Telegram.

### "Set up a passkey" when I try to send or sell

In a browser, every send and sale payment needs a passkey. Tap **Set up passkey** and follow your device's prompt. See [Lock the app with a passkey](../setup/passkey.md).

### "This device already has a passkey for Bitcoin Deepa"

You have already added a passkey on this device. Use that one. To start over, remove it under **App lock** in Profile & settings and add it again.

### I can't find the passkey setting in Telegram

Passkeys don't work inside Telegram. Use Telegram's own passcode lock: in Telegram, go to **Settings › Privacy and Security**.

## Verification

### "Verification required"

Plans, buying and selling need a verified identity. Tap **Complete verification** or **Verify** and follow [Verify your identity](../setup/verify-your-identity.md).

### "Use your phone"

Verification needs a phone camera. Open Bitcoin Deepa on your phone, sign in with the same Telegram account, and start from there.

### The Start verification button is greyed out

One of the fields is not valid yet. Check the red message under each field. For the phone number, use a Sri Lankan number such as `0771234567`.

### My verification was declined

Tap **Verify**, then **Start new verification**. Use a document that is not expired, make sure the whole document is in the photo and readable, and take the selfie in good light without a hat or sunglasses.

### My verification has been in review for more than 24 hours

Reviews usually finish within 24 hours. Check the status under **Identity** in Profile & settings. If it still says **In review** after that, contact support.

## Payments

### "Couldn't Start Payment" or "Couldn't open PayHere"

The app could not open the PayHere checkout. Check your connection and try again.

### I paid, but I don't see my bitcoin

Open the **Activity** tab and find the payment.

- **Processing** or **Pending**: the payment is still being confirmed, or the bitcoin is on its way. Give it a few minutes.
- If the purchase page said **Payment under review**, the team is checking the payment before sending your sats. This usually takes a few hours.
- **Failed** or **Cancelled**: the payment did not go through and nothing was charged.

Do not pay a second time for the same purchase while the first one is still being confirmed.

### "Payment status unknown" or "Purchase not found"

The app could not match the payment. If you paid, it will appear in **Activity** once it is confirmed. If it does not, contact support with the time and amount of the payment.

## Selling

### The Sell screen says "Add a bank account"

You need a verified bank account before your first sale. Tap **Add bank**. See [Add a bank account](../setup/add-a-bank-account.md).

### "Bank account in review"

Your statement is still being checked, which usually takes a few hours. You can sell as soon as the account shows **Verified**.

### My bank account was rejected

The account could not be matched to your identity. Tap **Add another account** in Profile & settings and add an account that is in your own name, with a statement that clearly shows your name and the account number.

### "Rate expired. Refresh to continue"

The rate lock ran out before you confirmed. Nothing was sold. Tap **Refresh** for a new rate.

### "Minimum is … sats" or "That's more than your balance"

The amount is outside what you can sell. Enter an amount between the minimum and your movable balance, or tap **All** or **Max**.

### "You can use … sats. … are in savings pots"

Some of your sats are locked in savings pots in the wallet bot. Sell up to your movable balance, or withdraw the sats from the pot in the bot first.

### The sale is waiting for me to approve the payment

Tap **Pay … sats** in the app, or **✅ Pay** in the bot chat, before the countdown runs out. If it runs out, the sale is cancelled and nothing is sold.

### "We're checking this sale"

Something took longer than expected. The team is checking the sale and will contact you. Do not sell again until it is resolved.

### I can't remove my bank account

A sale to that account is still in progress. Wait until it is finished, then remove the account.

## Sending

### The app can't find the username

Check the spelling. Usernames are 3 to 20 letters, digits or underscores, starting with a letter. The person must have [set up a Bitcoin Deepa username](../setup/set-up-your-username.md): their Telegram username doesn't work here.

### "You can send … more sats today" or "Maximum per send is … sats"

You have reached a sending limit. Send a smaller amount, or wait until tomorrow.

### "Reopen to send", "Log in to send" or "Connect your wallet"

Your app needs to link to your bot wallet again. Inside Telegram, tap **Close the app** and open it again from the bot. In a browser, tap **Log in with Telegram**. Then send again. The same message can appear when you pay for a sale.

### "We couldn't confirm this payment yet"

The app lost track of the payment. Hold **Send** again to check. It won't send twice.

## Getting help

Ask on [Bitcoin Deepa's Telegram](https://t.me/BitcoinDeepa), or message the [Bitcoin Deepa bot](https://t.me/BitcoinDeepaBot). When you ask for help, include:

- Your Bitcoin Deepa or Telegram username.
- What you were doing and the exact message you saw.
- The **Transaction ID** from the Activity tab, or the **Reference** from the sale or payment page, if it is about a payment, sale or send.

Never share your passkey, the QR code from the bot's `/link` command, or a verification code with anyone, including someone who says they are from support.
