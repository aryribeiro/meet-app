// Teste do modelo/validação do webchat em Node puro (mesma função da chamada).
import { parseChatPayload, sanitizeChatText } from "../src/lib/shared/chat.ts";
import { CHAT_MAX_CHARS } from "../src/lib/shared/constants.ts";
import { check, summary } from "./_helpers.mjs";

check("texto simples passa intacto", sanitizeChatText("oi, tudo bem?") === "oi, tudo bem?");
check("HTML NÃO é interpretado nem removido — vira texto literal", sanitizeChatText("<b>x</b>") === "<b>x</b>");
check("quebra de linha e tab sobrevivem", sanitizeChatText("a\nb\tc") === "a\nb\tc");
check("CRLF vira LF", sanitizeChatText("a\r\nb") === "a\nb");
check(
  "caracteres de controle somem (por code point)",
  sanitizeChatText("a" + String.fromCodePoint(0x07) + "b" + String.fromCodePoint(0x1b) + "c") === "abc",
);
check(
  "invisíveis/bidi somem (zero-width, RLO, BOM)",
  sanitizeChatText("a​b‮c﻿d") === "abcd",
);
check("emoji fora do BMP sobrevive", sanitizeChatText("🎥 ok") === "🎥 ok");
check("espaços nas pontas caem", sanitizeChatText("   x  ") === "x");
check(
  `corta em ${CHAT_MAX_CHARS} caracteres (por code point, não por UTF-16)`,
  Array.from(sanitizeChatText("🎥".repeat(CHAT_MAX_CHARS + 50))).length === CHAT_MAX_CHARS,
);

check("payload válido passa", parseChatPayload({ id: "abc", text: "olá", at: 1 })?.text === "olá");
check("sem text descarta", parseChatPayload({ id: "abc" }) === null);
check("text não-string descarta", parseChatPayload({ id: "abc", text: 5 }) === null);
check("id vazio descarta", parseChatPayload({ id: "", text: "x" }) === null);
check("id gigante descarta", parseChatPayload({ id: "x".repeat(33), text: "x" }) === null);
check("só espaços/controle descarta", parseChatPayload({ id: "a", text: "  " }) === null);
check("bloco gigante descartado antes de sanitizar", parseChatPayload({ id: "a", text: "x".repeat(CHAT_MAX_CHARS * 4 + 1) }) === null);
check("at inválido vira agora", typeof parseChatPayload({ id: "a", text: "x", at: "ontem" })?.at === "number");
check("null/primitivo descarta", parseChatPayload(null) === null && parseChatPayload("x") === null);

summary("Webchat (modelo)");
