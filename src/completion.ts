/* Copyright © Ben Mewburn ben@mewburn.id.au
 * Licensed under the MIT Licence.
 */

import {Position, Token, TokenType, Phrase, PhraseFlag, PhraseType} from 'php7parser';
import {documentContextFactory, DocumentContext, TypeResolver} from './visitors';
import {PhpSymbol, SymbolStore, DocumentSymbols} from './symbol';
import {ParsedDocument, AstStore} from './parse';

'use strict';

export class CompletionProvider{

    constructor(public astStore:AstStore, public symbolStore:SymbolStore){
        
    }

    suggest(pos:Position, uri:string){

        let parsedDoc = this.astStore.getParsedDocument(uri);
        let docSymbols = this.symbolStore.getDocumentSymbols(uri);

        if(!parsedDoc || !docSymbols){
            return [];
        }

        let context = documentContextFactory(pos, parsedDoc, docSymbols);

        switch(context.token.tokenType){
            case TokenType.T_OBJECT_OPERATOR:

                break;
            case TokenType.T_PAAMAYIM_NEKUDOTAYIM:

                break;
            case TokenType.T_VARIABLE:
            case '$':

                break;
            case TokenType.T_STRING:

                break;
            default:
                break;
        }

    }

    private _objectOperator(context:DocumentContext){

        let ast = context.ast.ancestor((x)=>{
            return (<Phrase>x.value).phraseType === PhraseType.Property ||
                (<Phrase>x.value).phraseType === PhraseType.MethodCall;
        });



    }

    private _staticMember(){

    }

    private _staticProperty(){

    }

    private _staticFunction(){

    }

    private _member(){

    }

    private _property(){

    }

    private _method(){

    }

    private _variable(){

    }

    private _function(){

    }

    private _class(){

    }

    private _classOrFunctionOrConstant(){

    }


}