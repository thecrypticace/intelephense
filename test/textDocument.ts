import { TextDocument } from '../src/textDocument';
import {Position} from 'vscode-languageserver-types';
import { assert } from 'chai';
import 'mocha';


var src =
`<?php

    $var = 1;

`;

var doc = new TextDocument('test', src);

describe('TextDocument', function () {

    describe('lineOffsets', function () {

        it('correct line offsets', function () {

            assert.deepEqual(doc.lineOffsets, [0, 6, 7, 21, 22]);

        })


    });

    describe('positionAtOffset', function(){

        it('correct position ', function(){
            assert.deepEqual(doc.positionAtOffset(12), <Position>{
                line:2,
                character:5
            });
        });

    });

    describe('offsetAtPosition', function(){

        it('correct offset', function(){
            assert.equal(doc.offsetAtPosition({
                line:2,
                character:9
            }), 16);

        });

    })


});