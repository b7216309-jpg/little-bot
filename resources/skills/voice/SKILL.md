---
name: voice
description: Speak out loud with Windows' built-in voices, or save speech as a WAV file to send. Use when the user asks you to say, read or announce something aloud, or wants a voice message.
---
# Voice

Windows includes speech synthesis (System.Speech). Speaking plays on the PC's speakers right away, so speak only when the user asked for it.

## Voices

List them: `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { '{0} | {1} | {2}' -f $_.VoiceInfo.Name, $_.VoiceInfo.Culture, $_.VoiceInfo.Gender }`

Match the language of the text: a French text needs a fr-FR voice (usually "Microsoft Hortense Desktop"), English text an en-US voice ("Microsoft Zira Desktop" or "Microsoft David Desktop"). Other languages need voices the user can add in Settings > Time & language > Speech.

## Speak

```
Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SelectVoice('Microsoft Hortense Desktop')
$voice.Rate = 0      # -10 (slow) to 10 (fast)
$voice.Volume = 100  # 0 to 100
$text = @'
Bonjour ! Ceci est un message de Little Bot.
'@
$voice.Speak($text)
$voice.Dispose()
```

Put the text in a here-string so quotes and apostrophes cannot break the command. `Speak` waits until it finishes, at about 150 words a minute; keep spoken text to a few paragraphs.

## Voice messages

Save to a file instead of the speakers, then send it:
`$voice.SetOutputToWaveFile("$PWD\message.wav"); $voice.Speak($text); $voice.Dispose()` and `attachment_send({ path: "message.wav" })`.

## Expression

- Pauses and emphasis with SSML: `$voice.SpeakSsml("<speak version='1.0' xml:lang='fr-FR'>Attention <break time='600ms'/> <emphasis>maintenant</emphasis>.</speak>")`.
- Play your character: a slower rate for a calm or old voice, faster for excitement. Remove Markdown, emoji and asterisk actions from text before speaking it.
