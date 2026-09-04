// Hooks de módulo para rodar arquivos .ts de src/ direto no Node (testes puros):
// - import relativo sem extensão dentro de src/ → acrescenta ".ts";
// - .ts carrega como módulo TypeScript (Node 24 remove os tipos; sem warning).
// Uso: node --import ./tests/_ts-hooks.mjs tests/<teste>.mjs
import { register } from "node:module";

register("./_ts-loader.mjs", import.meta.url);
