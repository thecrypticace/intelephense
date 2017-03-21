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

    export function openDocument(uri: string, documentText: string) {

        let doc = new TextDocument(uri, documentText);
        documentStore.add(doc);
        let parseTree = new ParseTree(uri, Parser.parse(documentText));
        parseTreeStore.add(parseTree);
        let symbolTable = SymbolTable.create(parseTree, doc);
        symbolStore.add(symbolTable);

    }

    export function closeDocument(uri: string) {
        documentStore.remove(uri);
        parseTreeStore.remove(uri);
    }

    export function syncDocument(uri: string, documentText: string) {
        documentStore.remove(uri);
        parseTreeStore.remove(uri);
        symbolStore.remove(uri);
        openDocument(uri, documentText);
    }

    export function documentSymbols(uri: string) {

        let symbolTable = symbolStore.getSymbolTable(uri);
        if(!symbolTable){
            return [];
        }

        symbolTable.importTable

    }

    function toSymbolInformation(s: PhpSymbol) {

        return <lsp.SymbolInformation>{
            kind:lspSymbolKind(s),
            name:s.name,
            location: s.location,
            containerName:s.scope
        };

    }

    function lspSymbolKind(s: PhpSymbol) {

        switch (s.kind) {
            case SymbolKind.Class:
                return lsp.SymbolKind.Class;
            case SymbolKind.Constant:
                return lsp.SymbolKind.Constant;
            case SymbolKind.Function:
                return lsp.SymbolKind.Function;
            case SymbolKind.Interface:
                return lsp.SymbolKind.Interface;
            case SymbolKind.Method:
                return s.name === '__construct' ?
                    lsp.SymbolKind.Constructor :
                    lsp.SymbolKind.Method;
            case SymbolKind.Namespace:
                return lsp.SymbolKind.Namespace;
            case SymbolKind.Property:
                return lsp.SymbolKind.Property;
            case SymbolKind.Trait:
                return lsp.SymbolKind.Module;
            case SymbolKind.Variable:
            case SymbolKind.Parameter:
                return lsp.SymbolKind.Variable;
            default:
                throw new Error('Invalid Argument');

        }

    }


}
