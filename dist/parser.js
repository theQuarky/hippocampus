"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFile = parseFile;
// src/parser.ts
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = __importDefault(require("mammoth"));
async function parseFile(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
    switch (ext) {
        case '.txt':
        case '.md':
            return fs_1.default.readFileSync(filePath, 'utf-8');
        case '.pdf': {
            const buffer = fs_1.default.readFileSync(filePath);
            const data = await (0, pdf_parse_1.default)(buffer);
            return data.text;
        }
        case '.docx': {
            const result = await mammoth_1.default.extractRawText({ path: filePath });
            return result.value;
        }
        default:
            throw new Error(`Unsupported file type: ${ext}`);
    }
}
