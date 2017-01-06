/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

import { Position, Token, TokenType, Phrase, PhraseFlag, PhraseType, Range } from 'php7parser';
import { DocumentContext } from './visitors';
import { PhpSymbol, SymbolStore, DocumentSymbols, SymbolTree, SymbolKind, SymbolModifier, TypeString } from './symbol';
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
    kind?: CompletionItemKind,
    detail?: string;
    documentation?: string;
    insertText?: string;
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
        let items: CompletionItem[];

        switch (context.token.tokenType) {
            case TokenType.T_OBJECT_OPERATOR:
                items = this._objectOperator(context);
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

        return items;

    }

    private _suggestInstanceMembers(context: DocumentContext) {

        let items: CompletionItem[] = [];
        let phrase = context.phraseNode;
        let text = '';
        let prefix = '';
        let token = context.token;
        let replaceRange: Range;

        if (token.tokenType === TokenType.T_STRING) {
            let nChars = 1 + context.position.char - token.range.start.char;
            text = token.text.substr(0, nChars);
            replaceRange = { start: token.range.start, end: context.position };
        } else if (token.tokenType === TokenType.T_OBJECT_OPERATOR) {
            prefix = '->';
            replaceRange = token.range;
        } else {
            return items;
        }

        let type = context.typeResolveExpression(phrase[0]);

        if (!type) {
            return items;
        }

        let thisTypeName = context.thisName;
        let baseTypeName = context.thisExtendsName;
        let symbols:Tree<PhpSymbol>[] = [];
        let predicateFactory = this._instanceMembersPredicate;

        type.atomicClassArray().forEach((typeName)=>{
            Array.prototype.push.apply(
                symbols, 
                this.symbolStore.lookupTypeMembers(typeName, predicateFactory(typeName, thisTypeName, baseTypeName, text)));
        });

        return this._memberSymbolsToCompletionItems(symbols, replaceRange, prefix);

    }

    private _memberSymbolsToCompletionItems(symbols: Tree<PhpSymbol>[], replaceRange: Range, prefix: string) {

        let items: CompletionItem[] = [];
        for (let n = 0; n < symbols.length; ++n) {

        }

    }

    private _memberSymbolToCompletionItem(symbol: Tree<PhpSymbol>, replaceRange: Range, prefix: string) {

        switch (symbol.value.kind) {
            case SymbolKind.Property:
                return this._propertySymbolToCompletionItem(symbol, replaceRange, prefix);
            case SymbolKind.Method:
                return this._methodSymbolToCompletionItem(symbol, replaceRange, prefix);
            case SymbolKind.Constant:

            default:
                throw new Error('Invalid Argument');
        }

    }

    private _memberSymbols(typeString: TypeString, phraseType: PhraseType, text?: string, thisTypeName?: string, baseTypeName?: string) {

        let typeNames = typeString.atomicClassArray();
        let symbols: Tree<PhpSymbol>[] = [];
        let name: string;
        let predicate: Predicate<Tree<PhpSymbol>>;

        for (let n = 0; n < typeNames.length; ++n) {
            name = typeNames[n];
            predicate = this._memberPredicate(phraseType, name, thisTypeName, baseTypeName, text);
            Array.prototype.push.apply(symbols, this.symbolStore.lookupTypeMembers(name, predicate));
        }

        return symbols;

    }

    private _instanceMembersPredicate(typeName: string, thisTypeName: string, thisExtendsTypeName: string, text?: string): Predicate<Tree<PhpSymbol>> {
        let predicate: Predicate<Tree<PhpSymbol>>;

        if (typeName === thisTypeName) {
            predicate = SymbolTree.instanceInternalMembersPredicate;
        } else if (typeName === thisExtendsTypeName) {
            predicate = SymbolTree.instanceInheritedMembersPredicate;
        } else {
            predicate = SymbolTree.instanceExternalMembersPredicate;
        }

        if (!text) {
            return predicate;
        }

        return (x) => {
            return predicate(x) && x.value.name.indexOf(text) >= 0;
        }
    }

    private _staticMemberPredicate(typeName: string, thisTypeName: string, thisExtendsTypeName: string, text?: string): Predicate<Tree<PhpSymbol>> {

        let predicate: Predicate<Tree<PhpSymbol>>;

        if (typeName === thisTypeName) {
            predicate = SymbolTree.staticInternalMembersPredicate;
        } else if (typeName === thisExtendsTypeName) {
            predicate = SymbolTree.staticInheritedMembersPredicate;
        } else {
            predicate = SymbolTree.staticExternalMembersPredicate;
        }

        if (!text) {
            return predicate;
        }

        return (x) => {
            return predicate(x) && x.value.name.indexOf(text) >= 0;
        }

    }

    private _propertySymbolToCompletionItem(symbol: Tree<PhpSymbol>, range: Range, prefix = '') {
        let name = !(symbol.value.modifiers & SymbolModifier.Static) ? symbol.value.name.slice(1) : symbol.value.name;
        let item: CompletionItem = {
            label: name,
            kind: CompletionItemKind.Property,
            insertText: prefix + name,
            range: range
        };

        if (symbol.value.type) {
            item.detail = symbol.value.type.toString();
        }

        if (symbol.value.description) {
            item.documentation = symbol.value.description;
        }

        return item;
    }

    private _methodSymbolToCompletionItem(symbol: Tree<PhpSymbol>, range: Range, prefix = '') {
        let item: CompletionItem = {
            label: symbol.value.name,
            kind: CompletionItemKind.Method,
            insertText: prefix + name,
            range: range,
        };

        if (symbol.value.signature) {
            item.detail = symbol.value.signature;
        }

        if (symbol.value.description) {
            item.documentation = symbol.value.description;
        }

        return item;
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