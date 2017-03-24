/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { TextDocument, DocumentStore } from './document';
import { Parser } from 'php7parser';
import { ParseTree, ParseTreeStore } from './parse';
import { SymbolStore, SymbolTable, SymbolKind, PhpSymbol } from './symbol';
import * as lsp from 'vscode-languageserver-types';

export interface Logger {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
}

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

    export var logger: Logger;
    export var enableDebug: boolean;

    function debug(msg: string) {
        if (enableDebug && logger) {
            logger.info(msg);
        }
    }

    function info(msg: string) {
        if (logger) {
            logger.info(msg);
        }
    }

    function warn(msg: string) {
        if (logger) {
            logger.warn(msg);
        }
    }

    function error(msg: string) {
        if (logger) {
            logger.error(msg);
        }
    }

    function elapsed(startTimestamp: number, endTimestamp: number) {
        return endTimestamp - startTimestamp;
    }

    function timestamp() {
        return Date.now();
    }

    export function openDocument(uri: string, text: string) {

        debug(`Opening ${uri}`);
        let doc = new TextDocument(uri, text);
        documentStore.add(doc);
        let ts = timestamp();
        let parseTree = new ParseTree(uri, Parser.parse(text));
        debug(`${uri} parsed in ${elapsed(ts, timestamp())} ms`);
        parseTreeStore.add(parseTree);
        ts = timestamp();
        let symbolTable = SymbolTable.create(parseTree, doc);
        symbolStore.add(symbolTable);
        debug(`${uri} symbols indexed in ${elapsed(ts, timestamp())} ms`);

    }

    export function closeDocument(uri: string) {
        debug(`Closing ${uri}`);
        documentStore.remove(uri);
        parseTreeStore.remove(uri);
    }

    export function editDocument(
        uri: string,
        changes: lsp.TextDocumentContentChangeEvent[]) {

        let doc = documentStore.find(uri);

        if (!doc) {
            debug(`Changes to ${uri} not applied`)
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

        let ts = timestamp();
        changes.sort(compareFn);
        let change:lsp.TextDocumentContentChangeEvent;
        
        for (let n = 0, l = changes.length; n < l; ++n) {
            change = changes[n];
            doc.applyEdit(change.range.start, change.range.end, change.text);
        }

        debug(`Changes to ${uri} applied in ${elapsed(ts, timestamp())} ms`);
        debug(doc.fullText);

    }

    export function documentSymbols(uri: string) {

        let ts = timestamp();
        let symbolTable = symbolStore.getSymbolTable(uri);

        if (!symbolTable) {
            debug(`Document symbols for ${uri} not found`);
            return [];
        }

        let symbols = symbolTable.symbols.map<lsp.SymbolInformation>(toDocumentSymbolInformation);
        debug(`Document symbols for ${uri} fetched in ${elapsed(ts, timestamp())} ms`);
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
