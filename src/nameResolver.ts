/* 
 * Copyright (c) Ben Robert Mewburn
 * Licensed under the ISC Licence.
 * 
 */

'use strict';

import * as lsp from 'vscode-languageserver-types';
import { PhpSymbol, SymbolKind } from './symbol';
import { ParsedDocument, ParsedDocumentStore } from './parsedDocument';
import { Context } from './context';
import {
    Phrase, PhraseType, Token, TokenType, NamespaceDefinition, NamespaceName,
    FullyQualifiedName, RelativeQualifiedName, QualifiedName
} from 'php7parser';
import { TreeTraverser, TreeVisitor } from './types';

export class NameResolver {

    constructor(
        public document: ParsedDocument,
        public importedSymbolStubs?: PhpSymbol[],
        public namespaceName?: string,
        public className?: string,
        public classBaseName?: string
    ) {
        if(!this.className){
            this.className = '';
        }

        if(!this.importedSymbolStubs){
            this.importedSymbolStubs = [];
        }

        if(!this.namespaceName){
            this.namespaceName = '';
        }

        if(!this.className){
            this.className = '';
        }

        if(!this.classBaseName){
            this.classBaseName = '';
        }
     }

    resolveRelative(relativeName: string) {
        return this.concatNamespaceName(this.namespaceName, relativeName);
    }

    resolveNotFullyQualified(notFqn: string, kind: SymbolKind) {

        if (!notFqn) {
            return '';
        }

        if (notFqn === 'self' || notFqn === 'static' || notFqn === '$this') {
            return this.className;
        }

        if (notFqn === 'parent') {
            return this.classBaseName;
        }

        let pos = notFqn.indexOf('\\');
        return pos < 0 ?
            this._resolveUnqualified(notFqn, kind) :
            this._resolveQualified(notFqn, pos);
    }

    concatNamespaceName(prefix: string, suffix: string) {
        if (!suffix || !prefix) {
            return suffix;
        } else {
            return prefix + '\\' + suffix;
        }
    }

    createAnonymousName(node: Phrase) {
        return this.document.createAnonymousName(node);
    }

    /**
     * Resolves name node to FQN
     * @param node 
     * @param kind needed to resolve qualified names against import rules
     */
    resolveNameNode(node:Phrase, kind:SymbolKind){
        if(!node){
            return '';
        }

        switch (node.phraseType) {
            case PhraseType.QualifiedName:
                return this.resolveNotFullyQualified(this.namespaceNameNodeText((<QualifiedName>node).name), kind);
            case PhraseType.RelativeQualifiedName:
                return this.resolveRelative(this.namespaceNameNodeText((<RelativeQualifiedName>node).name));
            case PhraseType.FullyQualifiedName:
                return this.namespaceNameNodeText((<FullyQualifiedName>node).name);
            case PhraseType.NamespaceName:
                return this.namespaceNameNodeText(<NamespaceName>node);
            default:
                return '';
        }
    }

    nodeText(node:Phrase|Token, ignore?:TokenType[]){
        return this.document.nodeText(node, ignore);
    }

    namespaceNameNodeText(node: NamespaceName) {

        if(ParsedDocument.isPhrase(node, [PhraseType.NamespaceName])){
            return '';
        }

        return this.document.nodeText(node, [TokenType.Comment, TokenType.Whitespace]);

    }

    private _matchImportedSymbol(text: string, kind: SymbolKind) {
        let s: PhpSymbol;
        for (let n = 0, l = this.importedSymbolStubs.length; n < l; ++n) {
            s = this.importedSymbolStubs[n];
            if (s.name && s.kind === kind && text === s.name) {
                return s;
            }
        }
        return null;
    }

    private _resolveQualified(name: string, pos: number) {
        let s = this._matchImportedSymbol(name.slice(0, pos), SymbolKind.Class);
        return s ? s.associated[0].name + name.slice(pos) : this.resolveRelative(name);
    }

    private _resolveUnqualified(name: string, kind: SymbolKind) {
        let s = this._matchImportedSymbol(name, kind);
        return s ? s.associated[0].name : this.resolveRelative(name);
    }

}