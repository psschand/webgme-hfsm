/*globals define*/
/*jshint node:true, browser:true*/

/**
 * Generated by PluginGenerator 1.7.0 from webgme on Fri Sep 09 2016 09:21:15 GMT-0500 (Central Daylight Time).
 * A plugin that inherits from the PluginBase. To see source code documentation about available
 * properties and methods visit %host%/docs/source/PluginBase.html.
 */

define([
    'plugin/PluginConfig',
    'text!./metadata.json',
    'plugin/PluginBase',
    'common/util/ejs', // for ejs templates
    './Templates/Templates',
    'text!./static/project.bgproj',
    'text!./static/project.xml',
    'text!./static/attributes.txt',
    'text!./static/cdc.xml',
    'text!./static/config.xml',
    'text!./static/gatt.xml',
    'text!./static/hardware.xml',
    'text!./static/v1_uuids.txt',
    'text!./static/v4_uuids.txt',
    'hfsm/modelLoader',
    'q'
], function (
    PluginConfig,
    pluginMetadata,
    PluginBase,
    ejs,
    TEMPLATES,
    BGPROJ,
    PROJ,
    ATTRIBUTES,
    CDC,
    CONFIG,
    GATT,
    HARDWARE,
    V1UUIDS,
    V4UUIDS,
    loader,
    Q) {
    'use strict';

    pluginMetadata = JSON.parse(pluginMetadata);

    /**
     * Initializes a new instance of GenerateBGS.
     * @class
     * @augments {PluginBase}
     * @classdesc This class represents the plugin GenerateBGS.
     * @constructor
     */
    var GenerateBGS = function () {
        // Call base class' constructor.
        PluginBase.call(this);
        this.pluginMetadata = pluginMetadata;
        this.FILES = {
            'script.bgs': 'script.bgs.ejs'
        };
    };

    /**
     * Metadata associated with the plugin. Contains id, name, version, description, icon, configStructue etc.
     * This is also available at the instance at this.pluginMetadata.
     * @type {object}
     */
    GenerateBGS.metadata = pluginMetadata;

    // Prototypical inheritance from PluginBase.
    GenerateBGS.prototype = Object.create(PluginBase.prototype);
    GenerateBGS.prototype.constructor = GenerateBGS;

    GenerateBGS.prototype.notify = function(level, msg) {
	var self = this;
	var prefix = self.projectId + '::' + self.projectName + '::' + level + '::';
	var max_msg_len = 100;
	if (level=='error')
	    self.logger.error(msg);
	else if (level=='debug')
	    self.logger.debug(msg);
	else if (level=='info')
	    self.logger.info(msg);
	else if (level=='warning')
	    self.logger.warn(msg);
	self.createMessage(self.activeNode, msg, level);
	self.sendNotification(prefix+msg);
    };

    /**
     * Main function for the plugin to execute. This will perform the execution.
     * Notes:
     * - Always log with the provided logger.[error,warning,info,debug].
     * - Do NOT put any user interaction logic UI, etc. inside this method.
     * - callback always has to be called even if error happened.
     *
     * @param {function(string, plugin.PluginResult)} callback - the result callback
     */
    GenerateBGS.prototype.main = function (callback) {
        // Use self to access core, project, result, logger etc from PluginBase.
        // These are all instantiated at this point.
        var self = this,
            nodeObject;

        // Default fails
        self.result.success = false;

	// the active node for this plugin is software -> project
	var projectNode = self.activeNode;
	self.projectName = self.core.getAttribute(projectNode, 'name');

	self.projectModel = {}; // will be filled out by loadProjectModel (and associated functions)
	self.artifacts = {}; // will be filled out and used by various parts of this plugin

	loader.logger = self.logger;

      	loader.loadModel(self.core, projectNode, true)
  	    .then(function (projectModel) {
		self.projectModel = projectModel.root;
		self.projectObjects = projectModel.objects;
        	return self.generateStateFunctions();
  	    })
	    .then(function () {
		return self.generateArtifacts();
	    })
	    .then(function () {
		self.notify('info', "Generated artifacts.");
        	self.result.setSuccess(true);
        	callback(null, self.result);
	    })
	    .catch(function (err) {
		self.notify('error', err);
        	self.result.setSuccess(false);
        	callback(err, self.result);
	    })
		.done();
    };

    /* 
       TODO:
	* Handle initialization routines
	* Figure out how to properly handle END states
    */

    GenerateBGS.prototype.generateStateFunctions = function () {
	var self = this;
	if (self.projectModel.State_list) {
	    self.projectModel.State_list.map(function(state) {
		self.getStateTimer(state, '  ');
		self.getStateIRQ(state, '  ');
	    });
	}
    };

    GenerateBGS.prototype.getStateGuardCode = function(state, prefix) {
	var self = this;
	var guardCode = '';
	guardCode += `${prefix}# STATE::${state.name}\n`;
	guardCode += `${prefix}if (changeState = 0 && stateLevel_${state.stateLevel} = ${state.stateName}) then\n`;
	guardCode += `${prefix}  # STATE::${state.name}::TRANSITIONS\n`;
	return guardCode;
    };

    GenerateBGS.prototype.getSetStateCode = function(state, prefix) {
	var self = this;
	var code = `${prefix}stateLevel_${state.stateLevel} = ${state.stateName}\n`;
	if (self.projectObjects[state.parentPath].type == 'State') {
	    code += self.getSetStateCode(self.projectObjects[state.parentPath], prefix);
	}
	return code;
    };
    
    GenerateBGS.prototype.getTransitionCode = function(state, transition, prefix) {
	var self = this;
	var transFunc = '';
	var guard = transition.guard;
	var nextState = self.projectObjects[transition.nextState];
	//self.notify('info', state.name);
	var transitionFunc = transition.function;
	transitionFunc += self.getInitFunc(nextState);
	nextState = self.getStartState(nextState);
	var period = parseInt(parseFloat(nextState.timerPeriod) * 32768.0);
	transFunc += `${prefix}if ( ${guard} ) then\n`;
	transFunc += `${prefix}  changeState = 1\n`;
	transFunc += `${prefix}  # TRANSITION::${state.name}->${nextState.name}\n`;
	transFunc += self.getSetStateCode(nextState, prefix + '  ');
	transFunc += `${prefix}  # stop the current state timer (to change period)\n`;
	transFunc += `${prefix}  call hardware_set_soft_timer( 0, state_timer_handle, 0)\n`;
	transFunc += `${prefix}  # start state timer (@ next states period)\n`;
	transFunc += `${prefix}  call hardware_set_soft_timer( ${period}, state_timer_handle, 0)\n`;
	transFunc += `${prefix}  # execute the transition function\n`;
	var tLines = transitionFunc.split('\n');
	tLines.map(function(line) {
	    transFunc += `${prefix}  ${line}\n`;
	});
	transFunc += `${prefix}end if\n`;
	return transFunc;
    };

    GenerateBGS.prototype.getStateTimer = function(state, prefix) {
	var self = this;
	if (prefix === undefined) {
	    prefix = '';
	}
	// use state.transitions object which was built in loader.processModel()
	var tPaths = Object.keys(state.transitions);
	var timerFunc = '';
	timerFunc += self.getStateGuardCode(state, prefix);
	var tPaths = Object.keys(state.transitions);
	tPaths.map(function(tPath) {
	    timerFunc += self.getTransitionCode(state, state.transitions[tPath], prefix + '  ');
	});
	if (state.State_list) {
	    state.State_list.map(function(substate) {
		var subStateFunc = self.getStateTimer(substate, prefix + '  ');
		timerFunc += subStateFunc;
	    });
	}
	timerFunc += `${prefix}  # STATE::${state.name}::FUNCTION\n`;
	timerFunc += `${prefix}  if (changeState = 0) then\n`;
	var funcLines = state.function.split('\n');
	funcLines.map(function(line) {
	    timerFunc += `${prefix}    ${line}\n`;
	});
	timerFunc += `${prefix}  end if\n`;
	timerFunc += `${prefix}end if\n`;
	state.timerFunc = timerFunc;
	return timerFunc;
    };

    GenerateBGS.prototype.getStateIRQ = function(state, prefix) {
	var self = this;
	if (prefix === undefined) {
	    prefix = '';
	}
	// use state.transitions object which was built in loader.processModel()
	var tPaths = Object.keys(state.transitions);
	var irqFunc = '';
	irqFunc += self.getStateGuardCode(state, prefix);
	var tPaths = Object.keys(state.transitions);
	tPaths.map(function(tPath) {
	    irqFunc += self.getTransitionCode(state, state.transitions[tPath], prefix + '  ');
	});
	if (state.State_list) {
	    state.State_list.map(function(substate) {
		var subStateFunc = self.getStateIRQ(substate, prefix + '  ');
		irqFunc += subStateFunc;
	    });
	}
	irqFunc += `${prefix}end if\n`;
	state.irqFunc = irqFunc;
	return irqFunc;
    };

    GenerateBGS.prototype.getStartState = function(state) {
	var self = this;
	var initState = state;
	//self.notify('info', '\t->'+state.name);
	if (state.State_list && state.Initial_list) {
	    if (state.Initial_list.length > 1)
		throw new String("State " + state.name + ", " +state.path+" has more than one init state!");
	    var init = state.Initial_list[0];
	    var tPaths = Object.keys(init.transitions);
	    if (tPaths.length == 1) {
		var dstPath = init.transitions[tPaths[0]].nextState;
		initState = self.getStartState(self.projectObjects[dstPath]);
	    }
	    else {
		throw new String("State " + state.name + ", " +state.path+" must have exactly one transition coming out of init!");
	    }
	}
	else if (state.State_list) {
	    throw new String("State " + state.name + ", " + state.path+" has no init state!");
	}
	return initState;
    };

    GenerateBGS.prototype.getInitFunc = function(state) {
	var self = this;
	var initState = state;
	var tFunc = '\n'
	//self.notify('info', '\t->'+state.name);
	if (state.State_list && state.Initial_list) {
	    if (state.Initial_list.length > 1)
		throw new String("State " + state.name + ", " +state.path+" has more than one init state!");
	    var init = state.Initial_list[0];
	    var tPaths = Object.keys(init.transitions);
	    if (tPaths.length == 1) {
		var dstPath = init.transitions[tPaths[0]].nextState;
		tFunc += init.transitions[tPaths[0]].function + self.getInitFunc(self.projectObjects[dstPath]);
	    }
	    else {
		throw new String("State " + state.name + ", " +state.path+" must have exactly one transition coming out of init!");
	    }
	}
	else if (state.State_list) {
	    throw new String("State " + state.name + ", " + state.path+" has no init state!");
	}
	return tFunc;
    };

    GenerateBGS.prototype.generateArtifacts = function () {
	var self = this;

	if (self.projectModel.Initial_list) {
	    var init = self.projectModel.Initial_list[0];
	    var tPaths = Object.keys(init.transitions);
	    if (tPaths.length == 1) {
		var dstPath = init.transitions[tPaths[0]].nextState;
		var tFunc = init.transitions[tPaths[0]].function;
		var initState = self.getStartState(self.projectObjects[dstPath]);
		self.projectModel.initState = initState;
		self.projectModel.initStateCode = self.getSetStateCode(initState, '  ');
		self.projectModel.initFunc = tFunc + self.getInitFunc(self.projectObjects[dstPath]);
	    }
	    else {
		throw new String("Top-level FSM must have exactly one initial state!");
	    }
	}
	else {
	    throw new String("Top-level FSM has no initial state!");
	}

	self.artifacts[self.projectModel.name + '.json'] = JSON.stringify(self.projectModel, null, 2);
        self.artifacts[self.projectModel.name + '_metadata.json'] = JSON.stringify({
    	    projectID: self.project.projectId,
            commitHash: self.commitHash,
            branchName: self.branchName,
            timeStamp: (new Date()).toISOString(),
            pluginVersion: self.getVersion()
        }, null, 2);

	var states = []
	for (var objPath in self.projectObjects) {
	    var obj = self.projectObjects[objPath];
	    if (obj.type == 'State') {
		states.push(obj);
	    }
	}

	var scriptTemplate = TEMPLATES[self.FILES['script.bgs']];
	self.artifacts['script.bgs'] = ejs.render(scriptTemplate, {
	    'model': self.projectModel,
	    'states': states
	});

	self.artifacts['constants.bgs'] = self.projectModel.constants;
	self.artifacts['globals.bgs'] = self.projectModel.globals;

	if (self.projectModel.Library_list) {
	    self.projectModel.Library_list.map(function(library) {
		var libFileName = library.name + '.bgs';
		self.artifacts[libFileName] = library.code;
		if (library.Event_list) {
		    library.Event_list.map(function(event) {
			self.artifacts[libFileName] += '\n'+event.function;
		    });
		}
	    });
	}

	self.artifacts['project.bgproj'] = BGPROJ;
	self.artifacts['project.xml'] = PROJ;
	self.artifacts['attributes.txt'] = ATTRIBUTES;
	self.artifacts['cdc.xml'] = CDC;
	self.artifacts['config.xml'] = CONFIG;
	self.artifacts['gatt.xml'] = GATT;
	self.artifacts['hardware.xml'] = HARDWARE;
	self.artifacts['v1_uuids.txt'] = V1UUIDS;
	self.artifacts['v4_uuids.txt'] = V4UUIDS;

	var fileNames = Object.keys(self.artifacts);
	var artifact = self.blobClient.createArtifact('GeneratedFiles');
	var deferred = new Q.defer();
	artifact.addFiles(self.artifacts, function(err) {
	    if (err) {
		deferred.reject(err.message);
		return;
	    }
	    self.blobClient.saveAllArtifacts(function(err, hashes) {
		if (err) {
		    deferred.reject(err.message);
		    return;
		}
		self.result.addArtifact(hashes[0]);
		deferred.resolve();
	    });
	});
	return deferred.promise;
    };

    return GenerateBGS;
});
