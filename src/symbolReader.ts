/* Copyright (c) Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

'use strict';

import { Position, Range, Predicate, TreeVisitor, Event, BinarySearch, SuffixArray } from './types';
import {
    Phrase, Token, PhraseType, TokenType, NamespaceName, FunctionDeclarationHeader,
    ReturnType, TypeDeclaration, QualifiedName, ParameterDeclarationList,
    ParameterDeclaration, ConstElement, FunctionDeclaration,
} from 'php7parser';
import { ParseTree, TextDocument } from './document';
import { PhpDocParser, PhpDoc, Tag } from './phpDoc';
import {
    PhpSymbol, NameResolver, ImportRule, ImportTable, SymbolKind, TypeString,
    SymbolModifier, SymbolTree, VariableTable, SymbolStore, DocumentSymbols
} from './symbol';

export class SymbolReader implements TreeVisitor<Phrase | Token> {

    lastPhpDoc: PhpDoc;

    constructor(
        public textDocument: TextDocument,
        public nameResolver: NameResolver,
        public spine: PhpSymbol[]
    ) {

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

    export var nameResolver: NameResolver;
    export var textDocument: TextDocument;

    function tokenText(t:Token){
        
    }

    export function functionDeclaration(node: FunctionDeclaration) {
        if (!node) {
            return null;
        }

        let s: PhpSymbol = {
            kind: SymbolKind.Function,
            name: null
        }



    }

    export function functionDeclarationHeader(s:PhpSymbol, node: FunctionDeclarationHeader, phpDoc: PhpDoc) {

        if (!node) {
            return null;
        }

        s.name = textDocument.tokenText(node.name);

        if (node.parameterList) {
            s.children = parameterList(node.parameterList, phpDoc);
        }

        if (node.returnType) {
            let returnTypeString = returnType(node.returnType);
            if (returnTypeString) {
                s.type = new TypeString(returnTypeString);
            }
        }

        if (phpDoc) {
            s.description = phpDoc.text;
            if (phpDoc.returnTag) {
                s.type = s.type ? s.type.merge(phpDoc.returnTag.typeString) :
                    new TypeString(phpDoc.returnTag.typeString);
            }
        }

        if (s.type) {
            s.type = s.type.nameResolve(nameResolver);
        }

        return s;
    }

    export function parameterList(node: ParameterDeclarationList, phpDoc: PhpDoc) {

        let parameters: PhpSymbol[] = [];
        let p: PhpSymbol;

        if (!node || !node.elements) {
            return parameters;
        }

        for (let n = 0, l = node.elements.length; n < l; ++n) {
            p = parameterDeclaration(node.elements[n], phpDoc);
            if (p) {
                parameters.push(p);
            }
        }

        return parameters;

    }

    export function parameterDeclaration(node: ParameterDeclaration, phpDoc: PhpDoc) {
        if (!node || !node.name) {
            return null;
        }

        let s: PhpSymbol = {
            kind: SymbolKind.Parameter,
            name: tokenTextDelegate(node.name)
        };

        if (node.type) {
            let paramTypeString = typeDeclaration(node.type);
            if (paramTypeString) {
                s.type = new TypeString(paramTypeString);
            }
        }

        if (phpDoc) {
            let tag = phpDoc.findParamTag(s.name);
            if (tag) {
                s.description = tag.description;
                s.type = s.type ? s.type.merge(tag.typeString) : new TypeString(tag.typeString);
            }
        }

        return s;
    }

    export function returnType(node: ReturnType) {

        if (!node || !node.type) {
            return null;
        }

        return typeDeclaration(node.type);

    }

    export function typeDeclaration(node: TypeDeclaration) {

        if (!node || !node.name) {
            return null;
        }

        return (<Phrase>node.name).phraseType ?
            qualifiedName(<QualifiedName>node.name, SymbolKind.Class) :
            tokenTextDelegate(<Token>node.name);

    }

    export function qualifiedName(node: QualifiedName, kind: SymbolKind) {
        if (!node || !node.name) {
            return null;
        }

        let name = namespaceName(node.name);
        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return nameResolver.resolveNotFullyQualified(name, kind);
            case PhraseType.RelativeQualifiedName:
                return nameResolver.resolveRelative(name);
            case PhraseType.FullyQualifiedName:
            default:
                return name;
        }
    }

    export function constElement(node: ConstElement) {

        if (!node || !node.name) {
            return null;
        }

        return {
            kind: SymbolKind.Constant,
            name: tokenTextDelegate(node.name),
            tokenRange: ParseTree.tokenRange(node)
        };

    }

    export function namespaceName(node: NamespaceName) {

        if (!node || !node.parts || node.parts.length < 1) {
            return null;
        }

        let parts: string[] = [];
        for (let n = 0, l = node.parts.length; n < l; ++n) {
            parts.push(tokenTextDelegate(node.parts[n]));
        }

        return parts.join('\\');

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
            range: ParseTree.tokenRange(node),
            children: []
        };

    }

}