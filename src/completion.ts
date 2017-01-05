/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

import { Position, Token, TokenType, Phrase, PhraseFlag, PhraseType, Range } from 'php7parser';
import { DocumentContext } from './visitors';
import { PhpSymbol, SymbolStore, DocumentSymbols, SymbolTree, SymbolKind, SymbolModifier } from './symbol';
import { ParsedDocument, AstStore } from './parse';
import { Tree, Predicate } from './types';

'use strict';

export enum CompletionItemKind {
    Text = 1,
    Method = 2,
    Function = 3,
    Constructor = 4,
    Field = 5,
    Variable = 6,
    Class = 7,
    Interface = 8,
    Module = 9,
    Property = 10,
    Unit = 11,
    Value = 12,
    Enum = 13,
    Keyword = 14,
    Snippet = 15,
    Color = 16,
    File = 17,
    Reference = 18
}

export interface CompletionItem {
    label: string,
    kind?:CompletionItemKind,
    detail?:string;
    documentation?:string;
    insertText?:string;
    range?: Range;
}

export class CompletionProvider {

    static maxSuggestions = 100;

    constructor(public astStore: AstStore, public symbolStore: SymbolStore) {

    }

    suggest(pos: Position, uri: string) {

        let parsedDoc = this.astStore.getParsedDocument(uri);
        let docSymbols = this.symbolStore.getDocumentSymbols(uri);

        if (!parsedDoc || !docSymbols) {
            return [];
        }

        let context = new DocumentContext(pos, parsedDoc, this.symbolStore);

        switch (context.token.tokenType) {
            case TokenType.T_OBJECT_OPERATOR:

                break;
            case TokenType.T_PAAMAYIM_NEKUDOTAYIM:

                break;
            case TokenType.T_VARIABLE:
            case '$':

                break;
            case TokenType.T_STRING:
            case TokenType.T_NS_SEPARATOR:

                break;
            default:
                break;
        }

    }

    private _objectOperator(context: DocumentContext) {

        let phrase = context.phraseNode;
        let typeString = context.typeResolveExpression(phrase.children[0]);

        if (!typeString) {
            return [];
        }

        let typeNames = typeString.atomicClassArray();
        let symbols: Tree<PhpSymbol>[] = [];
        let type: Tree<PhpSymbol>;
        let kindMask = SymbolKind.Class | SymbolKind.Interface;
        let name: string;
        let thisName = context.thisName;
        let predicate: Predicate<Tree<PhpSymbol>>;

        for (let n = 0; n < typeNames.length; ++n) {
            name = typeNames[n];
            if ((type = this.symbolStore.match(name, kindMask).shift())) {
                predicate = name === thisName ? SymbolTree.instanceInternalMembersPredicate : SymbolTree.instanceExternalMembersPredicate;
                Array.prototype.push.apply(symbols, this.symbolStore.lookupTypeMembers(type, predicate));
            }

        }

        let items:CompletionItem[] = [];
        let s:Tree<PhpSymbol>;
        for(let n = 0; n < symbols.length; ++n){
            s = symbols[n];
            items.push({    
                label: s.value.kind === SymbolKind.Property ? s.value.name.slice(1) : s.value.name,
                
            });

        }

    }

    private _staticMember() {

    }

    private _staticProperty() {

    }

    private _staticFunction() {

    }

    private _member() {

    }

    private _property() {

    }

    private _method() {

    }

    private _variable() {

    }

    private _function() {

    }

    private _class() {

    }

    private _classOrFunctionOrConstant() {

    }


}