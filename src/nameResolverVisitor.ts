/* 
 * Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 * 
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { PhpSymbol, SymbolKind } from './symbol';
import { NameResolver } from './nameResolver';
import { ParsedDocument, ParsedDocumentStore, NodeTransform } from './parsedDocument';
import { Context } from './context';
import { Phrase, PhraseType, Token, TokenType } from 'php7parser';
import { TreeTraverser, TreeVisitor } from './types';

export class NameResolverVisitor implements TreeVisitor<Phrase | Token> {

    private _namespaceUseDeclarationKind: SymbolKind;
    private _namespaceUseDeclarationPrefix: string;

    constructor(
        public document: ParsedDocument,
        public nameResolver: NameResolver
    ) {
    }

    preorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        let parent = spine.length ? <Phrase>spine[spine.length - 1] : <Phrase>{phraseType:PhraseType.Unknown, children:[]};

        switch ((<Phrase>node).phraseType) {

            case PhraseType.NamespaceDefinition:
                this.nameResolver.namespace = this.document.nodeText((<NamespaceDefinition>node).name);
                break;

            case PhraseType.NamespaceUseDeclaration:
                this._namespaceUseDeclarationKind = this._tokenToSymbolKind((<NamespaceUseDeclaration>node).kind);
                this._namespaceUseDeclarationPrefix = this.document.nodeText((<NamespaceUseDeclaration>node).prefix);
                break;

            case PhraseType.NamespaceUseClause:
                this.nameResolver.rules.push(this._namespaceUseClause(
                    <NamespaceUseClause>node,
                    this._namespaceUseDeclarationKind,
                    this._namespaceUseDeclarationPrefix
                ));
                break;

            case PhraseType.AnonymousClassDeclarationHeader:
                this.nameResolver.pushClassName(this._anonymousClassDeclarationHeader(<AnonymousClassDeclarationHeader>node,  parent));
                break;

            case PhraseType.ClassDeclarationHeader:
                this.nameResolver.pushClassName(this._classDeclarationHeader(<ClassDeclarationHeader>node));
                break;

            default:
                break;
        }

        return true;

    }

    postorder(node: Phrase | Token, spine: (Phrase | Token)[]) {

        switch ((<Phrase>node).phraseType) {
            case PhraseType.NamespaceDefinition:
                if ((<NamespaceDefinition>node).statementList) {
                    this.nameResolver.namespace = '';
                }
                break;

            case PhraseType.NamespaceUseDeclaration:
                this._namespaceUseDeclarationKind = 0;
                this._namespaceUseDeclarationPrefix = '';
                break;

            case PhraseType.ClassDeclaration:
            case PhraseType.AnonymousClassDeclaration:
                this.nameResolver.popClassName();
                break;

            default:
                break;
        }

    }

    private _classDeclarationHeader(node: ClassDeclarationHeader) {
        let names: [string, string] = [
            this.nameResolver.resolveRelative(this.document.tokenText(node.name)),
            ''
        ];

        if (node.baseClause) {
            names[1] = this._namePhraseToFqn(node.baseClause.name, SymbolKind.Class);
        }

        return names;
    }

    private _anonymousClassDeclarationHeader(node: AnonymousClassDeclarationHeader, parent:Phrase) {
        let names: [string, string] = [
            this.document.createAnonymousName(parent),
            ''
        ];

        if (node.baseClause) {
            names[1] = this._namePhraseToFqn(node.baseClause.name, SymbolKind.Class);
        }

        return names;
    }

    private _namespaceUseClause(node: NamespaceUseClause, kind: SymbolKind, prefix: string) {

        let fqn = this.nameResolver.concatNamespaceName(prefix, this.document.nodeText(node.name));

        if (!kind) {
            kind = SymbolKind.Class;
        }

        return <PhpSymbol>{
            kind: kind,
            name: node.aliasingClause ? this.document.nodeText(node.aliasingClause.alias) : PhpSymbol.notFqn(fqn),
            associated: [{ kind: kind, name: fqn }]
        };

    }

    protected _tokenToSymbolKind(t: Token) {

        if (!t) {
            return SymbolKind.None;
        }

        switch (t.tokenType) {
            case TokenType.Function:
                return SymbolKind.Function;
            case TokenType.Const:
                return SymbolKind.Constant;
            default:
                return SymbolKind.None;
        }
    }

    /**
     * Resolves name node to FQN
     * @param node 
     * @param kind needed to resolve qualified names against import rules
     */
    protected _namePhraseToFqn(node: Phrase, kind: SymbolKind) {
        if (!node) {
            return '';
        }

        let text = this.document.nodeText((<QualifiedName>node).name, [TokenType.Comment, TokenType.Whitespace]);

        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.nameResolver.resolveNotFullyQualified(text, kind);
            case PhraseType.RelativeQualifiedName:
                return this.nameResolver.resolveRelative(text);
            case PhraseType.FullyQualifiedName:
                return text;
            default:
                return '';
        }
    }

}


class NamespaceUseClauseListTransform implements NodeTransform {

    symbols:PhpSymbol[];

    constructor(public phraseType:PhraseType) {
        this.symbols = [];
     }

    push(transform:NodeTransform) {
        if(
            transform.phraseType === PhraseType.NamespaceUseClause || 
            transform.phraseType === PhraseType.NamespaceUseGroupClause
        ) {
            this.symbols.push((<NamespaceUseClauseTransform>transform).symbol);
        }
    }

}

class NamespaceUseDeclarationTransform implements NodeTransform {

    phraseType = PhraseType.NamespaceUseDeclaration;
    symbols: PhpSymbol[];
    private _kind = SymbolKind.Class;
    private _prefix = '';

    constructor() {
        this.symbols = [];
    }

    push(transform: NodeTransform) {
        if (transform.tokenType === TokenType.Const) {
            this._kind = SymbolKind.Constant;
        } else if (transform.tokenType === TokenType.Function) {
            this._kind = SymbolKind.Function;
        } else if (transform.phraseType === PhraseType.NamespaceName) {
            this._prefix = (<NamespaceNameTransform>transform).text;
        } else if (transform.phraseType === PhraseType.NamespaceUseGroupClauseList) {
            this.symbols = (<NamespaceUseClauseListTransform>transform).symbols;
            let s:PhpSymbol;
            let prefix = this._prefix ? this._prefix + '\\' : '';
            for(let n = 0; n < this.symbols.length; ++n) {
                s = this.symbols[n];
                s.name = prefix + s.name;
                if(!s.kind) {
                    s.kind = this._kind;
                }
            }
        } else if (transform.phraseType === PhraseType.NamespaceUseClauseList) {
            this.symbols = (<NamespaceUseClauseListTransform>transform).symbols;
            let s:PhpSymbol;
            for(let n = 0; n < this.symbols.length; ++n) {
                s = this.symbols[n];
                s.kind = this._kind;
            }
        }
    }

}

class NamespaceUseClauseTransform implements NodeTransform {

    symbol: PhpSymbol;

    constructor(public phraseType:PhraseType) {
        this.symbol = PhpSymbol.create(0, '');
    }

    push(transform: NodeTransform) {
        if(transform.tokenType === TokenType.Function) {
            this.symbol.kind = SymbolKind.Function;
        } else if(transform.tokenType === TokenType.Const) {
            this.symbol.kind = SymbolKind.Constant;
        } else if(transform.phraseType === PhraseType.NamespaceName) {
            this.symbol.name = (<NamespaceNameTransform>transform).text;
        }
    }

}

class NamespaceDefinitionTransform implements NodeTransform {

    phraseType = PhraseType.NamespaceDefinition;
    name = '';

    push(transform:NodeTransform) {
        if(transform.phraseType === PhraseType.NamespaceName) {
            this.name = (<NamespaceNameTransform>transform).text;
        }
    }

}

class NamespaceNameTransform implements NodeTransform {

    phraseType = PhraseType.NamespaceName;
    private _parts:string[];

    constructor() {
        this._parts = [];
    }

    push(transform:NodeTransform) {
        if(transform.tokenType === TokenType.Name) {
            this._parts.push((<TokenTransform>transform).text);
        }
    }

    get text() {
        return this._parts.join('\\');
    }

}

class TokenTransform implements NodeTransform {

    constructor(public token:Token, public doc:ParsedDocument) { }
    push(transform:NodeTransform) { }
    get text() {
        return this.doc.tokenText(this.token);
    }
}