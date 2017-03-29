/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { PhpSymbol, SymbolKind, SymbolStore, SymbolModifier } from './symbol';

const namespacedSymbolMask =
    SymbolKind.Interface |
    SymbolKind.Class |
    SymbolKind.Trait |
    SymbolKind.Constant |
    SymbolKind.Function;

export class SymbolProvider {

    constructor(public symbolStore: SymbolStore) { }

    /**
     * Excludes magic symbols
     * @param uri 
     */
    provideDocumentSymbols(uri: string) {
        let symbolTable = this.symbolStore.getSymbolTable(uri);
        let symbols = symbolTable ? symbolTable.symbols : [];
        let symbolInformationList: lsp.SymbolInformation[] = [];
        let s: PhpSymbol;

        for (let n = 0, l = symbols.length; n < l; ++n) {
            s = symbols[n];
            if (!(s.modifiers & SymbolModifier.Magic)) {
                symbolInformationList.push(toDocumentSymbolInformation(s));
            }
        }

        return symbolInformationList;
    }

    /**
     * Excludes internal symbols
     * @param query 
     */
    provideWorkspaceSymbols(query: string) {
        let matches = this.symbolStore.match(query);
        let symbolInformationList: lsp.SymbolInformation[] = [];
        const modifierMask = SymbolModifier.Anonymous |
            SymbolModifier.Use |
            SymbolModifier.Private;
        let s: PhpSymbol;

        for (let n = 0, l = matches.length; n < l; ++n) {
            s = matches[n];
            if (!(s.modifiers & modifierMask)) {
                symbolInformationList.push(toDocumentSymbolInformation(s));
            }
        }
        return symbolInformationList;
    }

}

function toDocumentSymbolInformation(s: PhpSymbol) {

    let si: lsp.SymbolInformation = {
        kind: null,
        name: s.name,
        location: s.location,
        containerName: s.scope
    };

    //check for symbol scope to exclude class constants
    if ((s.kind & namespacedSymbolMask) && !s.scope) {
        let nsSeparatorPos = s.name.lastIndexOf('\\');
        if (nsSeparatorPos >= 0) {
            si.name = s.name.slice(nsSeparatorPos + 1);
            si.containerName = s.name.slice(0, nsSeparatorPos);
        }
    }

    switch (s.kind) {
        case SymbolKind.Class:
            si.kind = lsp.SymbolKind.Class;
            break;
        case SymbolKind.Constant:
            si.kind = lsp.SymbolKind.Constant;
            break;
        case SymbolKind.Function:
            si.kind = lsp.SymbolKind.Function;
            break;
        case SymbolKind.Interface:
            si.kind = lsp.SymbolKind.Interface;
            break;
        case SymbolKind.Method:
            if (s.name === '__construct') {
                si.kind = lsp.SymbolKind.Constructor;
            } else {
                si.kind = lsp.SymbolKind.Method;
            }
            break;
        case SymbolKind.Namespace:
            si.kind = lsp.SymbolKind.Namespace;
            break;
        case SymbolKind.Property:
            si.kind = lsp.SymbolKind.Property;
            break;
        case SymbolKind.Trait:
            si.kind = lsp.SymbolKind.Module;
            break;
        case SymbolKind.Variable:
        case SymbolKind.Parameter:
            si.kind = lsp.SymbolKind.Variable;
            break;
        default:
            throw new Error(`Invalid argument ${s.kind}`);

    }

    return si;
}

