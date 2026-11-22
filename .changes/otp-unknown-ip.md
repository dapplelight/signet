### server: phone OTP no longer locks out every user when the client IP is unknown

- `requestPhoneOtp` used to count every request with a null `ip` in one shared bucket limited to 10 an hour, so a missing client IP (for example a wrong trust setting) blocked all users. Those requests now count against the new `PhoneOtpOptions.perUnknownIp` (`{ max, windowSeconds }`, default 200 per hour). The per-phone limit is unchanged, and requests with a real IP still use `perIp`.
