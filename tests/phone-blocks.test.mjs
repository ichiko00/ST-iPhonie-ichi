import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneMatches,replacePhoneBlocks} from '../core/phone-blocks.js';
import {phoneParts} from '../core/chat.js';
import {phoneContent} from '../core/story-sync.js';

test('reasoning examples and comments cannot swallow story or become messages',()=>{
 const prefix='<blend>计划使用 <phone> 标签\n例子: 未闭合</blend>\n<!-- 写前 <phone> -->\n<content>正文保留</content>\n';
 const raw=prefix+'<phone>甲: 真消息</phone>';
 assert.equal(replacePhoneBlocks(raw,()=> '[手机]'),prefix+'[手机]');
 assert.deepEqual(phoneParts(raw),[{group:'',text:'甲: 真消息'}]);
 assert.equal(phoneContent(raw),'|甲: 真消息');
});
test('complete examples in reasoning comments and code stay untouched',()=>{
 for(const wrapper of [x=>'<think>'+x+'</think>',x=>'<blend>'+x+'</blend>',x=>'<!-- '+x+' -->',x=>'```html\n'+x+'\n```',x=>'`'+x+'`']){
  const text=wrapper('<phone>甲: 示例</phone>');
  assert.equal(replacePhoneBlocks(text,()=>''),text);
  assert.equal(phoneParts(text).length,0);
 }
});
test('private and group blocks remain compatible including case and whitespace',()=>{
 const raw='<phone>甲: 你好</phone>正文<PHONE group="朋友">乙: 来电</PHONE >';
 assert.equal(phoneMatches(raw).length,2);
 assert.deepEqual(phoneParts(raw),[{group:'',text:'甲: 你好'},{group:'朋友',text:'乙: 来电'}]);
 assert.equal(replacePhoneBlocks(raw,()=> '[手机]'),'[手机]正文[手机]');
});
test('unfinished and nested openings preserve preceding story',()=>{
 const text='示例 <phone>\n正文\n<phone>甲: 真消息</phone>';
 assert.equal(replacePhoneBlocks(text,()=> '[手机]'),'示例 <phone>\n正文\n[手机]');
 assert.equal(replacePhoneBlocks('<phone>未完成',()=>''),'<phone>未完成');
});
