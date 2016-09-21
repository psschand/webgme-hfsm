/* Generated file based on ejs templates */
define([], function() {
    return {
    "script.bgs.ejs": "import \"constants.bgs\"\nimport \"globals.bgs\"\n# Import user libraries here (if any)\n<%\nif (model.Library_list) {\n  model.Library_list.map(function(library) {\n-%>\nimport \"<%- library.name %>.bgs\"\n<%\n  });\n}\n-%>\n\nconst state_timer_handle = 0\n\ndim changeState\n<%\nfor (var i=0; i<model.numHeirarchyLevels; i++) {\n-%>\ndim stateLevel_<%- i %>\n<%\n}\n-%>\n\n<%\nstates.map(function(state) {\n-%>\nconst <%- state.stateName %> = <%- state.stateID %>\n<%\n});\n-%>\n\n# The system_boot handler deals with all initialization needed.\nevent system_boot(major, minor, patch, build, ll_version, protocol_version, hw)\n  # user initialization code:\n  #\n  # START USER CODE\n  #\n<%- model.initialization %>\n  #\n  # END USER CODE\n  #\n  # generated initialization code for the state machine:\n  changeState = 0\n  # STATE::<%- model.initState.name %>\n<%- model.initStateCode %>\n  # execute the init transition for the chart\n<%- model.initFunc %>  \n  # Start the state timer\n  call hardware_set_soft_timer(<%- parseInt(parseFloat(model.initState.timerPeriod) * 32768.0) %>, state_timer_handle, 0)\nend\n\n# The timer handles all the state function code and state transition\n#  code\nevent hardware_soft_timer(handle)\n  changeState = 0\n  # Generated code to execute state transitions and state functions:\n<%\nif (model.State_list) {\n  model.State_list.map(function(state) {\n-%>\n<%- state.timerFunc %>\n<%\n  });\n}\n-%>\nend\n<%\nif (model.Event_list) {\n  model.Event_list.map(function(event) {\n-%>\n\n<%- event.function %>\n<%\n  });\n}\n-%>\n"
}});