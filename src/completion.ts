/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

import { Position, Token, TokenType, Phrase, PhraseFlag, PhraseType, Range } from 'php7parser';
import { DocumentContext } from './visitors';
import { PhpSymbol, SymbolStore, DocumentSymbols, SymbolTree, SymbolKind, SymbolModifier, TypeString } from './symbol';
import { ParsedDocument, AstStore, Ast } from './parse';
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

interface CompletionProvider {
    canComplete(context: DocumentContext): boolean;
    completions(context: DocumentContext): CompletionItem[];
}

export class MasterCompletionProvider {

    static maxSuggestions = 100;
    private _providers: CompletionProvider[];

    constructor(public astStore: AstStore, public symbolStore: SymbolStore) {
        this._providers = [

        ];
    }

    completions(pos: Position, uri: string) {

        let parsedDoc = this.astStore.getParsedDocument(uri);
        let docSymbols = this.symbolStore.getDocumentSymbols(uri);

        if (!parsedDoc || !docSymbols) {
            return [];
        }

        let context = new DocumentContext(pos, parsedDoc, this.symbolStore);
        let items: CompletionItem[] = [];

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


}

class TypeCompletionProvider implements CompletionProvider {

    constructor(public astStore: AstStore, public symbolStore: SymbolStore) { }

    canComplete(context: DocumentContext) {

        let token = context.token;
        let phrase = context.phraseNode;

        return (token.tokenType === TokenType.T_STRING ||
            token.tokenType === TokenType.T_NS_SEPARATOR) &&
            phrase.parent && (<Phrase>phrase.parent.value).phraseType === PhraseType.Name;

    }

    completions(context:DocumentContext){

        let nameNode = context.phraseNode.parent;
        let nChars = 1 + context.position.char - (<Phrase>context.phraseNode.value).startToken.range.start.char;
        let text = Ast.namespaceNameToString(context.phraseNode).substr(0, nChars);
        let replaceRange:Range = {
            start:(<Phrase>context.phraseNode.value).startToken.range.start,
            end: context.position
        };

        //catch name list
        //extends
        //type expr
        //implements
        //use traits
        //static func
        //use


    }

}

class MemberCompletionProvider implements CompletionProvider {

    constructor(public astStore: AstStore, public symbolStore: SymbolStore) { }

    canComplete(context: DocumentContext) {

        let token = context.token;
        let phrase = context.phraseNode;

        if (this._isMemberAccessNode(phrase) &&
            (token.tokenType === TokenType.T_PAAMAYIM_NEKUDOTAYIM ||
                token.tokenType === TokenType.T_OBJECT_OPERATOR ||
                token.tokenType === TokenType.T_STRING)) {
            return true;
        }

        if ((<Phrase>phrase.value).phraseType === PhraseType.Identifier &&
            this._isStaticMemberAccessNode(phrase.parent)) {
            return true;
        }

        if ((<Phrase>phrase.value).phraseType === PhraseType.Variable &&
            (this._isStaticMemberAccessNode(phrase.parent) ||
                (token.tokenType === '$' && phrase.parent && this._isStaticMemberAccessNode(phrase.parent.parent)))) {
            return true;
        }

        return false;

    }

    completions(context: DocumentContext) {

        let phrase = context.phraseNode;

        while (!this._isMemberAccessNode(phrase)) {
            phrase = phrase.parent;
        }

        let text = '';
        let prefix = '';
        let token = context.token;
        let replaceRange: Range;

        if (token.tokenType === TokenType.T_STRING ||
            token.tokenType === TokenType.T_VARIABLE ||
            token.tokenType === '$' ||
            (<Phrase>context.phraseNode.value).phraseType === PhraseType.Identifier) {
            let nChars = 1 + context.position.char - token.range.start.char;
            text = token.text.substr(0, nChars);
            replaceRange = { start: token.range.start, end: context.position };
        } else if (token.tokenType === TokenType.T_OBJECT_OPERATOR) {
            prefix = '->';
            replaceRange = token.range;
        } else if (token.tokenType === TokenType.T_OBJECT_OPERATOR) {
            prefix = '::';
            replaceRange = token.range;
        }
        else {
            return [];
        }

        let type = context.typeResolveExpression(phrase[0]);

        if (!type) {
            return [];
        }

        let thisTypeName = context.thisName;
        let baseTypeName = context.thisExtendsName;
        let symbols: Tree<PhpSymbol>[] = [];
        let predicateFactory = this._isInstanceMemberAccessNode(phrase) ?
            this._instanceMembersPredicate : this._staticMemberPredicate;

        //account for parent::
        if (this._isParent(phrase)) {
            predicateFactory = this._parentMemberPredicate;
        }

        type.atomicClassArray().forEach((typeName) => {
            Array.prototype.push.apply(
                symbols,
                this.symbolStore.lookupTypeMembers(typeName, predicateFactory(typeName, thisTypeName, baseTypeName, text)));
        });

        return this._memberSymbolsToCompletionItems(symbols, replaceRange, prefix);


    }

    private _memberSymbolsToCompletionItems(symbols: Tree<PhpSymbol>[], replaceRange: Range, prefix: string) {

        let items: CompletionItem[] = [];
        for (let n = 0; n < symbols.length; ++n) {
            items.push(this._memberSymbolToCompletionItem(symbols[n], replaceRange, prefix));
        }
        return items;

    }

    private _memberSymbolToCompletionItem(symbol: Tree<PhpSymbol>, replaceRange: Range, prefix: string) {

        switch (symbol.value.kind) {
            case SymbolKind.Property:
                return this._propertySymbolToCompletionItem(symbol, replaceRange, prefix);
            case SymbolKind.Method:
                return this._methodSymbolToCompletionItem(symbol, replaceRange, prefix);
            case SymbolKind.Constant:
                return this._constantSymbolToCompletionItem(symbol, replaceRange, prefix);
            default:
                throw new Error('Invalid Argument');
        }

    }

    private _constantSymbolToCompletionItem(symbol: Tree<PhpSymbol>, range: Range, prefix: string) {

        let item: CompletionItem = {
            label: symbol.value.name,
            kind: CompletionItemKind.Value,
            insertText: prefix + symbol.value.name,
            range: range,
        }

        if (symbol.value.description) {
            item.documentation = symbol.value.description;
        }

        return item;

    }

    private _propertySymbolToCompletionItem(symbol: Tree<PhpSymbol>, range: Range, prefix: string) {
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

    private _methodSymbolToCompletionItem(symbol: Tree<PhpSymbol>, range: Range, prefix: string) {
        let item: CompletionItem = {
            label: symbol.value.name,
            kind: CompletionItemKind.Method,
            insertText: prefix + symbol.value.name,
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

    private _isParent(phrase: Tree<Phrase | Token>) {
        return !!phrase.children[0].find((x) => {
            return x.value && (<Token>x.value).text === 'parent' &&
                x.parent.children.length === 1;
        });
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

    private _parentMemberPredicate(typeName: string, thisTypeName: string, thisExtendsTypeName: string, text?: string): Predicate<Tree<PhpSymbol>> {

        return (x) => {
            return (x.value.kind === SymbolKind.Method ||
                x.value.kind === SymbolKind.Constant ||
                (x.value.kind === SymbolKind.Property &&
                    (x.value.modifiers & SymbolModifier.Static) > 0)) &&
                (x.value.modifiers & (SymbolModifier.Public | SymbolModifier.Protected)) > 0 &&
                !text || x.value.name.indexOf(text) >= 0;

        };
    }

    private _isMemberAccessNode(node: Tree<Phrase | Token>) {

        return this._isInstanceMemberAccessNode(node) ||
            this._isStaticMemberAccessNode(node);
    }

    private _isStaticMemberAccessNode(node: Tree<Phrase | Token>) {
        if (!node.value) {
            return false;
        }

        switch ((<Phrase>node.value).phraseType) {
            case PhraseType.ClassConstant:
            case PhraseType.StaticMethodCall:
            case PhraseType.StaticProperty:
            case PhraseType.ErrorStaticMember:
                return true;
            default:
                return false;
        }
    }

    private _isInstanceMemberAccessNode(node: Tree<Phrase | Token>) {
        return node.value &&
            ((<Phrase>node.value).phraseType === PhraseType.Property ||
                (<Phrase>node.value).phraseType === PhraseType.MethodCall);

    }


}