import { PhpDoc, Tag, MethodTagParam, PhpDocParser } from '../src/phpDoc';
import { assert } from 'chai';
import 'mocha';

describe('PhpDocParser', function () {

    describe('#parse()', function () {

        it('Should parse @param', function () {

            let text = `/**
             * @param int $value
             * @param \\My\\Param $myParam Param description
             */`

            let phpDoc = PhpDocParser.parse(text);
            console.log(JSON.stringify(phpDoc.findParamTag('$value'), null, 4));

        });


        it('Should parse function doc block', function () {

            let text = `/**
             * Function summary.
             * Function description.
             * 
             * @param int $value
             * @param \\My\\Param $myParam Param description
             * @return \\My\\ReturnType
             */`

            let phpDoc = PhpDocParser.parse(text);
            //console.log(JSON.stringify(phpDoc.findParamTag('$value'), null, 4));

        });




    });


});