/* Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const lsp = require("vscode-languageserver-types");
const namespacedSymbolMask = 2 /* Interface */ |
    1 /* Class */ |
    4 /* Trait */ |
    8 /* Constant */ |
    64 /* Function */;
class SymbolProvider {
    constructor(symbolStore) {
        this.symbolStore = symbolStore;
    }
    /**
     * Excludes magic symbols
     * @param uri
     */
    provideDocumentSymbols(uri) {
        let symbolTable = this.symbolStore.getSymbolTable(uri);
        let symbols = symbolTable ? symbolTable.symbols : [];
        let symbolInformationList = [];
        let s;
        for (let n = 0, l = symbols.length; n < l; ++n) {
            s = symbols[n];
            if (s.location) {
                symbolInformationList.push(this.toDocumentSymbolInformation(s));
            }
        }
        return symbolInformationList;
    }
    /**
     * Excludes internal symbols
     * @param query
     */
    provideWorkspaceSymbols(query) {
        const maxItems = 100;
        let matches = this.symbolStore.match(query, null, true);
        let symbolInformationList = [];
        let s;
        for (let n = 0, l = matches.length; n < l && symbolInformationList.length < maxItems; ++n) {
            s = matches[n];
            if (this.workspaceSymbolFilter(s)) {
                symbolInformationList.push(this.toDocumentSymbolInformation(s));
            }
        }
        return symbolInformationList;
    }
    workspaceSymbolFilter(s) {
        return !(s.modifiers & (512 /* Anonymous */ | 4096 /* Use */ | 4 /* Private */)) &&
            s.location &&
            s.kind !== 128 /* Parameter */ &&
            (s.kind !== 256 /* Variable */ || !s.scope); //global vars 
    }
    toDocumentSymbolInformation(s) {
        let si = {
            kind: null,
            name: s.name,
            location: s.location,
            containerName: s.scope
        };
        if ((s.kind & namespacedSymbolMask) > 0) {
            let nsSeparatorPos = s.name.lastIndexOf('\\');
            if (nsSeparatorPos >= 0) {
                si.name = s.name.slice(nsSeparatorPos + 1);
                si.containerName = s.name.slice(0, nsSeparatorPos);
            }
        }
        switch (s.kind) {
            case 1 /* Class */:
                si.kind = lsp.SymbolKind.Class;
                break;
            case 8 /* Constant */:
            case 1024 /* ClassConstant */:
                si.kind = lsp.SymbolKind.Constant;
                break;
            case 64 /* Function */:
                si.kind = lsp.SymbolKind.Function;
                break;
            case 2 /* Interface */:
                si.kind = lsp.SymbolKind.Interface;
                break;
            case 32 /* Method */:
                if (s.name === '__construct') {
                    si.kind = lsp.SymbolKind.Constructor;
                }
                else {
                    si.kind = lsp.SymbolKind.Method;
                }
                break;
            case 512 /* Namespace */:
                si.kind = lsp.SymbolKind.Namespace;
                break;
            case 16 /* Property */:
                si.kind = lsp.SymbolKind.Property;
                break;
            case 4 /* Trait */:
                si.kind = lsp.SymbolKind.Module;
                break;
            case 256 /* Variable */:
            case 128 /* Parameter */:
                si.kind = lsp.SymbolKind.Variable;
                break;
            default:
                throw new Error(`Invalid argument ${s.kind}`);
        }
        return si;
    }
}
exports.SymbolProvider = SymbolProvider;
