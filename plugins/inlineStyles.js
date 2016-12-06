'use strict';

exports.type   = 'full';

exports.active = true;

exports.params = {
  onlyMatchedOnce:        true,
  removeMatchedSelectors: true
};

exports.description = 'inline styles (optionally skip selectors that match more than once)';


var SPECIFICITY = require('specificity'),
    stable      = require('stable'),
    csso        = require('csso'),
    selectCss   = require('../lib/ext/select-css'),
    findParent  = require('../lib/ext/find-parent');

/**
  * Moves + merges styles from style elements to element styles
  *
  * @author strarsis <strarsis@gmail.com>
  */
exports.fn = function(data, opts) {

  // collect <style/>s
  var styleEls      = selectCss('style', data);

  var styleItems    = [],
      selectorItems = [];
  for(var styleElIndex in styleEls) {
    var styleEl = styleEls[styleElIndex];

    if(styleEl.isEmpty()) {
      // skip empty <style/>s
      continue;
    }
    var cssStr = styleEl.content[0].text;

    // collect <style/>s and their css ast
    var cssAst = csso.parse(cssStr, {context: 'stylesheet'});
    styleItems.push({
      styleEl: styleEl,
      cssAst:  cssAst
    });

    // collect css selectors and their containing ruleset
    csso.walk(cssAst, function(node, item) {
      if(node.type === 'SimpleSelector') {
		// csso 'SimpleSelector' to be interpreted with CSS2.1 specs, _not_ with CSS3 Selector module specs:
	    // Selector group ('Selector' in csso) separated by comma: <'SimpleSelector'>, <'SimpleSelector'>, ...
        var selectorStr  = csso.translate(node);
        var selectorItem = {
          selectorStr:        selectorStr,
          simpleSelectorItem: item,
          rulesetNode:        this.ruleset
        };
        selectorItems.push(selectorItem);
      }
    });
  }

  // stable-sort css selectors by their specificity
  var selectorItemsSorted = stable(selectorItems, function(item1, item2) {
    return SPECIFICITY.compare(item1.selectorStr, item2.selectorStr);
  });

  // apply <style/> styles to matched elements
  for(var selectorItemIndex in selectorItemsSorted) {
    var selectorItem = selectorItemsSorted[selectorItemIndex],
        selectedEls  = selectCss(selectorItem.selectorStr, data);
    if(opts.onlyMatchedOnce && selectedEls.length > 1) {
      // skip selectors that match more than once if option onlyMatchedOnce is enabled
      continue;
    }

    for(var selectedElIndex in selectedEls) {
      var selectedEl = selectedEls[selectedElIndex];

      // merge element(inline) styles + matching <style/> styles

      var newInlineCssAst   = csso.parse('', {context: 'block'}); // for an empty css ast (in block context)
      csso.walk(selectorItem.rulesetNode, function(node, item) {
        if(node.type === 'Declaration') {
          newInlineCssAst.declarations.insert(item);
        }
      });

      var elInlineStyleAttr = selectedEl.attr('style');
      if(elInlineStyleAttr) {
        var elInlineStyles = elInlineStyleAttr.value,
            inlineCssAst   = csso.parse(elInlineStyles, {context: 'block'});

        csso.walk(inlineCssAst, function(node, item) {
            if(node.type === 'Declaration') {
            newInlineCssAst.declarations.insert(item);
            }
        });
      } else {
        elInlineStyleAttr = {name:'style', value:'', prefix:'', local:'style' }
      }

      var newCss = csso.translate(newInlineCssAst);

      elInlineStyleAttr.value = newCss;
      selectedEl.addAttr(elInlineStyleAttr);
    }

    if(opts.removeMatchedSelectors && selectedEls.length > 0) {
      // clean up matching simple selectors if option removeMatchedSelectors is enabled
      selectorItem.rulesetNode.selector.selectors.remove(selectorItem.simpleSelectorItem);
    }
  }

  // clean up <style/> rulesets without any css selectors left
  var styleItemIndex = 0,
      styleItem      = {};
  for(styleItemIndex in styleItems) {
    styleItem = styleItems[styleItemIndex];
    csso.walk(styleItem.cssAst, function(node, item, list) {
      if(node.type === 'Ruleset' &&
         node.selector.selectors.head == null) {
          list.remove(item);
      }
    });
  }

  // update / clean up <style/>s with their changed ast
  for(styleItemIndex in styleItems) {
    styleItem = styleItems[styleItemIndex];
    if(styleItem.cssAst.rules.isEmpty()){
      // clean up now emtpy <style/>s
      var styleParent = findParent(data, styleItem.styleEl);
      styleParent.content.splice(styleParent.content.indexOf(styleItem.styleEl), 1);
      continue;
    }

    // update existing, left over <style>s
    styleItem.styleEl.content[0].text = csso.translate(styleItem.cssAst);
  }

  return data;
};
