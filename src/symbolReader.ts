/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, TreeVisitor, Event, BinarySearch, SuffixArray } from './types';
import { Phrase, Token, PhraseType, TokenType } from 'php7parser';
import { ParseTree } from './document';
import { PhpDocParser, PhpDoc } from './phpDoc';
import {
    PhpSymbol, NameResolver, ImportRule, ImportTable, SymbolKind, TypeString,
    SymbolModifier, SymbolTree, VariableTable, SymbolStore, DocumentSymbols
} from './symbol';

export class SymbolReader implements TreeVisitor<Phrase | Token> {

    lastPhpDoc: PhpDoc;
    externalOnly: boolean;

    constructor(public uri: string, public importTable: ImportTable,
        public nameResolver: NameResolver, public spine: PhpSymbol[],
        public tokenTextDelegate: (t: Token) => string) {
        this.externalOnly = true;
    }

    preOrder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceUseDeclaration:
                this.importTable.addRuleMany(SymbolReader.namespaceUseDeclaration(<Phrase>node, this.tokenTextDelegate));
                return false;
            case PhraseType.NamespaceDefinition:
                let nsSymbol = SymbolReader.namespaceDefinition(<Phrase>node, this.tokenTextDelegate);
                this.nameResolver.namespace = nsSymbol.name;
                if (this.spine[this.spine.length - 1].kind === SymbolKind.Namespace) {
                    this.spine.pop();
                }
                this._addSymbol(nsSymbol, true);
                return true;
            case PhraseType.ConstElement:
                this._addSymbol(SymbolReader.constElement(<Phrase>node, this.tokenTextDelegate), false);
                return false;
            case PhraseType.FunctionDeclarationHeader:

                return true;
            case undefined:
                this._token(<Token>node);
                return false;
            default:
                return true;
        }

    }

    private _token(t: Token) {
        if (t.tokenType === TokenType.DocumentComment) {
            this.lastPhpDoc = PhpDocParser.parse(this.tokenTextDelegate(t));
        }
    }

    private _addSymbol(symbol: PhpSymbol, pushToSpine: boolean) {

        if (!symbol || !symbol.name) {
            return;
        }

        let parent = this.spine[this.spine.length - 1];
        parent.children.push(symbol);

        if (pushToSpine) {
            this.spine.push(symbol);
        }
    }

}


export namespace SymbolReader {

    export function functionDeclarationHeader(node: Phrase, nameResolver: NameResolver,
        tokenTextDelegate: (t: Token) => string, phpDoc: PhpDoc) : PhpSymbol {

        let name: string;
        let returnType:string;
        let child: Token | Phrase;

        for (let n = 0, l = node.children.length; n < l; ++n) {
            child = node.children[n];
            if ((<Token>child).tokenType === TokenType.Name){
                name = tokenTextDelegate(<Token>child);
            } else if((<Phrase>child).phraseType === PhraseType.ParameterDeclarationList){

            } else if((<Phrase>child).phraseType === PhraseType.ReturnType){

            }
        }

        return {
            kind:SymbolKind.Function,
            name
        };

    }

    export function constElement(node: Phrase, tokenTextDelegate: (t: Token) => string) {

        let nameToken = node.children ? node.children[0] as Token : null;
        if (!nameToken || nameToken.tokenType !== TokenType.Name) {
            return null;
        }

        return {
            kind: SymbolKind.Constant,
            name: tokenTextDelegate(nameToken),
            tokenRange: ParseTree.tokenRange(node)
        };

    }

    export function namespaceName(node: Phrase, tokenTextDelegate: (t: Token) => string) {

        let name = '';
        let child: Token;

        for (let n = 0, l = node.children.length; n < l; ++n) {
            child = node.children[n] as Token;
            if (child.tokenType === TokenType.Text) {
                name += tokenTextDelegate(child);
            } else if (child.tokenType === TokenType.ForwardSlash) {
                name += '/';
            }
        }

        return name;

    }

    function namespaceAliasingClause(node: Phrase, tokenTextDelegate: (t: Token) => string) {

        let child: Token;
        for (let n = 0, l = node.children.length; n < l; ++n) {
            child = node.children[n] as Token;
            if (child.tokenType === TokenType.Name) {
                return tokenTextDelegate(child);
            }
        }

        return null;

    }

    function namespaceUseClause(node: Phrase, kind: SymbolKind, prefix: string, tokenTextDelegate: (t: Token) => string) {

        let child: Token | Phrase;
        let rule: ImportRule = {
            kind: kind,
            fqn: null,
            alias: null
        };

        for (let n = 0, l = node.children.length; n < l; ++n) {
            child = node.children[n];
            if ((<Token>child).tokenType === TokenType.Const) {
                rule.kind = SymbolKind.Constant;
            } else if ((<Token>child).tokenType === TokenType.Function) {
                rule.kind = SymbolKind.Function;
            } else if ((<Phrase>child).phraseType === PhraseType.NamespaceName) {
                rule.fqn = namespaceName(<Phrase>child, tokenTextDelegate);
                if (prefix && rule.fqn) {
                    rule.fqn = prefix + '/' + rule.fqn;
                }
            } else if ((<Phrase>child).phraseType === PhraseType.NamespaceAliasingClause) {
                rule.alias = namespaceAliasingClause(<Phrase>child, tokenTextDelegate);
                break;
            }
        }

        return rule;

    }

    function namespaceUseClauseList(node: Phrase, kind: SymbolKind, prefix: string, tokenTextDelegate: (t: Token) => string) {

        let child: Phrase;
        let rule: ImportRule;
        let rules: ImportRule[] = [];

        if (!kind) {
            kind = SymbolKind.Class;
        }

        for (let n = 0, l = node.children.length; n < l; ++n) {
            child = node.children[n] as Phrase;
            if (child.phraseType === PhraseType.NamespaceUseClause ||
                child.phraseType === PhraseType.NamespaceUseGroupClause) {
                rule = namespaceUseClause(child, kind, prefix, tokenTextDelegate);
                if (rule.fqn) {
                    rules.push(rule);
                }
            }
        }

        return rules;

    }

    export function namespaceUseDeclaration(node: Phrase, tokenTextDelegate: (t: Token) => string) {

        let child: Phrase | Token;
        let kind = SymbolKind.None;
        let prefix = '';

        for (let n = 0, l = node.children.length; n < l; ++n) {
            child = node.children[n];

            if ((<Phrase>child).phraseType === PhraseType.NamespaceName) {
                prefix = namespaceName(<Phrase>child, tokenTextDelegate);
            } else if ((<Token>child).tokenType === TokenType.Const) {
                kind = SymbolKind.Constant;
            } else if ((<Token>child).tokenType === TokenType.Function) {
                kind = SymbolKind.Function;
            } else if ((<Phrase>child).phraseType === PhraseType.NamespaceUseClauseList ||
                (<Phrase>child).phraseType === PhraseType.NamespaceUseGroupClauseList) {
                return namespaceUseClauseList(<Phrase>child, kind, prefix, tokenTextDelegate);
            }
        }

        return [];

    }

    export function namespaceDefinition(node: Phrase, tokenTextDelegate: (t: Token) => string): PhpSymbol {

        let child: Phrase;
        let nsName = null;
        for (let n = 0, l = node.children.length; n < l; ++n) {
            child = node.children[n] as Phrase;
            if (child.phraseType === PhraseType.NamespaceName) {
                nsName = namespaceName(child, tokenTextDelegate);
                break;
            }
        }

        return {
            kind: SymbolKind.Namespace,
            name: nsName,
            tokenRange: ParseTree.tokenRange(node),
            children: []
        };

    }

}