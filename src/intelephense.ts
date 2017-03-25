/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { TextDocument, DocumentStore } from './document';
import { Parser } from 'php7parser';
import { ParseTree, ParseTreeStore } from './parse';
import { SymbolStore, SymbolTable, SymbolKind, PhpSymbol } from './symbol';
import * as lsp from 'vscode-languageserver-types';

export namespace Intelephense {

    var documentStore = new DocumentStore();
    var parseTreeStore = new ParseTreeStore();
    var symbolStore = new SymbolStore();
    const namespacedSymbolMask =
        SymbolKind.Interface |
        SymbolKind.Class |
        SymbolKind.Trait |
        SymbolKind.Constant |
        SymbolKind.Function;

    export function openDocument(uri: string, text: string) {

        let doc = new TextDocument(uri, text);
        documentStore.add(doc);
        let parseTree = new ParseTree(uri, Parser.parse(text));
        parseTreeStore.add(parseTree);
        let symbolTable = SymbolTable.create(parseTree, doc);
        symbolStore.add(symbolTable);

    }

    export function isDocumentOpen(uri:string){
        return documentStore.find(uri) !== null;
    }

    export function closeDocument(uri: string) {
        documentStore.remove(uri);
        parseTreeStore.remove(uri);
    }

    export function editDocument(
        uri: string,
        changes: lsp.TextDocumentContentChangeEvent[]) {

        let doc = documentStore.find(uri);

        if (!doc) {
            return;
        }

        let compareFn = (a: lsp.TextDocumentContentChangeEvent, b: lsp.TextDocumentContentChangeEvent) => {
            if (a.range.end.line > b.range.end.line) {
                return -1;
            } else if (a.range.end.line < b.range.end.line) {
                return 1;
            } else {
                return b.range.end.character - a.range.end.character;
            }
        }

        changes.sort(compareFn);
        let change:lsp.TextDocumentContentChangeEvent;
        
        for (let n = 0, l = changes.length; n < l; ++n) {
            change = changes[n];
            doc.applyEdit(change.range.start, change.range.end, change.text);
        }

    }

    export function documentSymbols(uri: string) {

        let symbolTable = symbolStore.getSymbolTable(uri);

        if (!symbolTable) {
            return [];
        }

        let symbols = symbolTable.symbols.map<lsp.SymbolInformation>(toDocumentSymbolInformation);
        return symbols;
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
                    s.kind = lsp.SymbolKind.Constructor;
                } else {
                    s.kind = lsp.SymbolKind.Method;
                }
                break;
            case SymbolKind.Namespace:
                s.kind = lsp.SymbolKind.Namespace;
                break;
            case SymbolKind.Property:
                s.kind = lsp.SymbolKind.Property;
                break;
            case SymbolKind.Trait:
                s.kind = lsp.SymbolKind.Module;
                break;
            case SymbolKind.Variable:
            case SymbolKind.Parameter:
                s.kind = lsp.SymbolKind.Variable;
            default:
                throw new Error('Invalid Argument');

        }

        return si;
    }
}
