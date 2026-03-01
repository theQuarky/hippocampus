"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cosine = cosine;
// src/sim.ts
function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}
