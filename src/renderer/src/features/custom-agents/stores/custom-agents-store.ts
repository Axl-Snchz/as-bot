import type {
  CheckCustomAgentInput,
  CustomAgentCheckResult,
  CustomAgentSummary,
  CustomAgentsDesktopApi,
  CustomAgentUsage,
  CustomProviderRestart,
  SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import { type CustomAgentUsageRow, customAgentRailRows } from "../custom-agent-rail-rows";

interface CustomAgentsState {
  agents: CustomAgentSummary[];
  /** False until the first list arrives, so an empty list is not read as "none saved". */
  loaded: boolean;
  /** The last answers to the usage prompts. An agent with no answer is not listed. */
  usage: CustomAgentUsage[];
}

/**
 * The user's own ACP agents, as the renderer sees them: the variable names, and never a value.
 *
 * The same shape as the custom providers store: the API is an accessor, an absent group leaves the
 * list empty, and the mutations write the list main returned and re-throw for the button that
 * started them.
 */
export function createCustomAgentsStore(api: () => CustomAgentsDesktopApi | undefined) {
  const [state, setState] = createStore<CustomAgentsState>({ agents: [], loaded: false, usage: [] });

  function apply(agents: CustomAgentSummary[]): void {
    setState((current) => {
      current.agents = agents;
      current.loaded = true;
    });
  }

  function customAgents(): CustomAgentSummary[] {
    return state.agents;
  }

  function customAgentsLoaded(): boolean {
    return state.loaded;
  }

  async function refreshCustomAgents(): Promise<void> {
    const group = api();
    if (!group) return;
    apply(await group.list());
  }

  /** All saved agents for the rail, in list order, with usage text when one exists. */
  function customAgentUsage(): CustomAgentUsageRow[] {
    return customAgentRailRows(state.agents, state.usage);
  }

  /** Each agent answers in a model-list process, so this can take as long as the slowest agent. */
  async function refreshCustomAgentUsage(): Promise<void> {
    const group = api();
    if (!group) return;
    const usage = await group.usage();
    setState((current) => {
      current.usage = usage;
    });
  }

  async function saveCustomAgent(input: SaveCustomAgentInput): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.saveUnavailable"));
    const result = await group.save(input);
    apply(result.agents);
    return result.restart;
  }

  async function deleteCustomAgent(id: string): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.removeUnavailable"));
    const result = await group.delete({ id });
    apply(result.agents);
    return result.restart;
  }

  /** One trial start. Writes nothing, so the list does not change. */
  async function checkCustomAgent(input: CheckCustomAgentInput): Promise<CustomAgentCheckResult> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.saveUnavailable"));
    return group.check(input);
  }

  return {
    customAgents,
    customAgentsLoaded,
    refreshCustomAgents,
    customAgentUsage,
    refreshCustomAgentUsage,
    saveCustomAgent,
    deleteCustomAgent,
    checkCustomAgent,
  };
}
