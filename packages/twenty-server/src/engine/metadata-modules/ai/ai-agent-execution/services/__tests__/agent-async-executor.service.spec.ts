import { Test, type TestingModule } from '@nestjs/testing';

import { getRepositoryToken } from '@nestjs/typeorm';
import { generateText, type ToolSet } from 'ai';
import { ToolCategory } from 'twenty-shared/ai';

import { BillingUsageService } from 'src/engine/core-modules/billing/services/billing-usage.service';
import { MetricsService } from 'src/engine/core-modules/metrics/metrics.service';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import {
  EXECUTE_TOOL_TOOL_NAME,
  LEARN_TOOLS_TOOL_NAME,
} from 'src/engine/core-modules/tool-provider/tools';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { OUTPUT_NAVIGATION_TOOL_NAMES } from 'src/engine/core-modules/tool/tools/output-navigation-tool/constants/output-navigation-tool-names.constant';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AgentAsyncExecutorService } from 'src/engine/metadata-modules/ai/ai-agent-execution/services/agent-async-executor.service';
import { type AgentEntity } from 'src/engine/metadata-modules/ai/ai-agent/entities/agent.entity';
import { NATIVE_WEB_SEARCH_COST_PER_CALL_DOLLARS } from 'src/engine/metadata-modules/ai/ai-billing/constants/native-web-search-cost-per-call-dollars';
import { AiBillingService } from 'src/engine/metadata-modules/ai/ai-billing/services/ai-billing.service';
import { AiModelConfigService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-config.service';
import { AiModelRegistryService } from 'src/engine/metadata-modules/ai/ai-models/services/ai-model-registry.service';
import { NativeToolBinderService } from 'src/engine/metadata-modules/ai/ai-models/services/native-tool-binder.service';
import { RoleTargetEntity } from 'src/engine/metadata-modules/role-target/role-target.entity';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/twenty-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';

jest.mock('ai', () => ({
  ...jest.requireActual('ai'),
  generateText: jest.fn().mockResolvedValue({
    text: '',
    steps: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      inputTokenDetails: {
        noCacheTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
    },
  }),
}));

const generateTextMock = generateText as jest.MockedFunction<
  typeof generateText
>;

describe('AgentAsyncExecutorService — workflow agent role-scoped tool resolution', () => {
  let service: AgentAsyncExecutorService;
  let toolRegistry: {
    buildToolIndex: jest.Mock;
    resolveAndExecute: jest.Mock;
    getToolInfo: jest.Mock;
    suggestSimilarToolNames: jest.Mock;
    spillToolOutputIfTooLarge: jest.Mock;
  };
  let roleTargetRepository: { findOne: jest.Mock };
  let aiBillingService: {
    decrementAndCheckAvailableCredits: jest.Mock;
    calculateCost: jest.Mock;
    emitAiTokenUsageEvent: jest.Mock;
    billNativeWebSearchUsage: jest.Mock;
  };

  const agentId = 'agent-1';
  const workspaceId = 'workspace-1';
  const agentRoleId = 'role-1';

  const buildAgent = (): AgentEntity =>
    ({
      id: agentId,
      workspaceId,
      modelId: 'openai/gpt-4.1',
      prompt: 'test prompt',
      modelConfiguration: {},
    }) as AgentEntity;

  beforeEach(async () => {
    toolRegistry = {
      buildToolIndex: jest.fn().mockResolvedValue([]),
      resolveAndExecute: jest
        .fn()
        .mockResolvedValue({ success: true, result: {} }),
      getToolInfo: jest.fn().mockResolvedValue([]),
      suggestSimilarToolNames: jest.fn().mockResolvedValue({}),
      spillToolOutputIfTooLarge: jest.fn(async (output) => output),
    };
    roleTargetRepository = { findOne: jest.fn() };
    aiBillingService = {
      decrementAndCheckAvailableCredits: jest
        .fn()
        .mockResolvedValue({ hasNoMoreAvailableCredits: false }),
      calculateCost: jest.fn().mockReturnValue(0),
      emitAiTokenUsageEvent: jest.fn(),
      billNativeWebSearchUsage: jest.fn(),
    };

    generateTextMock.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentAsyncExecutorService,
        {
          provide: AiModelRegistryService,
          useValue: {
            validateModelAvailability: jest.fn(),
            resolveModelForAgent: jest.fn().mockResolvedValue({
              modelId: 'openai/gpt-4.1',
              sdkPackage: '@ai-sdk/openai',
              model: {},
            }),
          },
        },
        {
          provide: AiModelConfigService,
          useValue: {
            getReasoningProviderOptions: jest.fn().mockReturnValue({}),
          },
        },
        { provide: ToolRegistryService, useValue: toolRegistry },
        {
          provide: NativeToolBinderService,
          useValue: {
            bind: jest.fn().mockReturnValue({}),
          },
        },
        { provide: AiBillingService, useValue: aiBillingService },
        {
          provide: BillingUsageService,
          useValue: {
            hasAvailableCreditsOrThrow: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementCounterForEvent: jest.fn(),
          },
        },
        {
          provide: getWorkspaceScopedRepositoryToken(RoleTargetEntity),
          useValue: roleTargetRepository,
        },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: { findOneBy: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = module.get<AgentAsyncExecutorService>(AgentAsyncExecutorService);
  });

  it('builds the lazy tool catalog scoped to the agent role when one is assigned', async () => {
    roleTargetRepository.findOne.mockResolvedValueOnce({ roleId: agentRoleId });

    await service.executeAgent({
      agent: buildAgent(),
      userPrompt: 'test',
      workspaceId,
    });

    expect(toolRegistry.buildToolIndex).toHaveBeenCalledTimes(1);
    expect(toolRegistry.buildToolIndex).toHaveBeenCalledWith(
      workspaceId,
      agentRoleId,
      expect.any(Object),
    );
  });

  it('does not resolve registry tools when the agent has no role (fail-closed)', async () => {
    roleTargetRepository.findOne.mockResolvedValueOnce(null);

    await service.executeAgent({
      agent: buildAgent(),
      userPrompt: 'test',
      workspaceId,
    });

    expect(toolRegistry.buildToolIndex).not.toHaveBeenCalled();
  });

  describe('lazy tool catalog & recursion-safety guard', () => {
    const [navToolName] = OUTPUT_NAVIGATION_TOOL_NAMES;

    const buildIndexEntry = (
      name: string,
      category: ToolCategory,
      extra: Partial<ToolIndexEntry> = {},
    ): ToolIndexEntry =>
      ({
        name,
        label: name,
        description: `${name} description`,
        category,
        executionRef: { kind: 'test' },
        ...extra,
      }) as ToolIndexEntry;

    // A role catalog spanning allowed categories (DATABASE_CRUD, ACTION), an
    // output-navigation tool (allowed category but must stay hidden/denied) and
    // a WORKFLOW tool (disallowed category — the recursion-safety case).
    const buildMixedCatalog = (): ToolIndexEntry[] => [
      buildIndexEntry('create_person', ToolCategory.DATABASE_CRUD, {
        objectName: 'person',
        operation: 'create_one',
      }),
      buildIndexEntry('send_email', ToolCategory.ACTION),
      buildIndexEntry(navToolName, ToolCategory.ACTION),
      buildIndexEntry('create_workflow', ToolCategory.WORKFLOW),
    ];

    type ExecutableTool = {
      execute: (
        input: unknown,
      ) => Promise<{ success?: boolean; error?: string }>;
    };

    const getGenerateTextArgs = (): { system: string; tools: ToolSet } => {
      const calls = generateTextMock.mock.calls;
      const lastCall = calls[calls.length - 1];

      return lastCall?.[0] as unknown as { system: string; tools: ToolSet };
    };

    const executeMetaTool = (
      tools: ToolSet,
      name: string,
      input: unknown,
    ): Promise<{ success?: boolean; error?: string }> =>
      (tools[name] as unknown as ExecutableTool).execute(input);

    beforeEach(() => {
      roleTargetRepository.findOne.mockResolvedValue({ roleId: agentRoleId });
      toolRegistry.buildToolIndex.mockResolvedValue(buildMixedCatalog());
    });

    it('registers only the lazy meta-tools and lists allowed tools while hiding workflow/navigation tools', async () => {
      await service.executeAgent({
        agent: buildAgent(),
        userPrompt: 'test',
        workspaceId,
      });

      const { system, tools } = getGenerateTextArgs();

      expect(Object.keys(tools)).toEqual(
        expect.arrayContaining([LEARN_TOOLS_TOOL_NAME, EXECUTE_TOOL_TOOL_NAME]),
      );
      // Full per-tool schemas are no longer eagerly registered in the ToolSet.
      expect(tools).not.toHaveProperty('create_person');
      expect(tools).not.toHaveProperty('send_email');

      // Allowed tools appear in the catalog section of the system prompt...
      expect(system).toContain('send_email');
      expect(system).toContain('person');
      // ...while disallowed-category and navigation tools are hidden.
      expect(system).not.toContain('create_workflow');
      expect(system).not.toContain(navToolName);
    });

    it('denies execute_tool for workflow and navigation tools but routes allowed tools to the registry', async () => {
      await service.executeAgent({
        agent: buildAgent(),
        userPrompt: 'test',
        workspaceId,
      });

      const { tools } = getGenerateTextArgs();

      const workflowResult = await executeMetaTool(
        tools,
        EXECUTE_TOOL_TOOL_NAME,
        {
          toolName: 'create_workflow',
          arguments: {},
        },
      );
      const navResult = await executeMetaTool(tools, EXECUTE_TOOL_TOOL_NAME, {
        toolName: navToolName,
        arguments: {},
      });

      expect(workflowResult.success).toBe(false);
      expect(navResult.success).toBe(false);
      expect(toolRegistry.resolveAndExecute).not.toHaveBeenCalled();

      await executeMetaTool(tools, EXECUTE_TOOL_TOOL_NAME, {
        toolName: 'create_person',
        arguments: { name: 'Ada' },
      });

      expect(toolRegistry.resolveAndExecute).toHaveBeenCalledWith(
        'create_person',
        { name: 'Ada' },
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('strips excluded tools from learn_tools before resolving their schemas', async () => {
      await service.executeAgent({
        agent: buildAgent(),
        userPrompt: 'test',
        workspaceId,
      });

      const { tools } = getGenerateTextArgs();

      await executeMetaTool(tools, LEARN_TOOLS_TOOL_NAME, {
        toolNames: ['create_person', 'create_workflow', navToolName],
        aspects: ['description'],
      });

      expect(toolRegistry.getToolInfo).toHaveBeenCalledTimes(1);
      expect(toolRegistry.getToolInfo.mock.calls[0][0]).toEqual([
        'create_person',
      ]);
    });
  });

  describe('cost folding', () => {
    const baseUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      inputTokenDetails: {
        noCacheTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
    };

    it('returns token cost only when no native web searches happened', async () => {
      roleTargetRepository.findOne.mockResolvedValueOnce({
        roleId: agentRoleId,
      });
      aiBillingService.calculateCost.mockReturnValue(0.0042);
      generateTextMock.mockResolvedValueOnce({
        text: '',
        steps: [{ toolCalls: [] }],
        usage: baseUsage,
      } as unknown as Awaited<ReturnType<typeof generateText>>);

      const result = await service.executeAgent({
        agent: buildAgent(),
        userPrompt: 'test',
        workspaceId,
      });

      expect(result.nativeWebSearchCallCount).toBe(0);
      expect(result.totalCostInDollars).toBeCloseTo(0.0042, 6);
      // credits = dollars * 1_000_000
      expect(result.creditsUsedMicro).toBe(4200);
    });

    it('folds native web search dollars into totalCostInDollars and creditsUsedMicro', async () => {
      roleTargetRepository.findOne.mockResolvedValueOnce({
        roleId: agentRoleId,
      });
      aiBillingService.calculateCost.mockReturnValue(0.01);
      generateTextMock.mockResolvedValueOnce({
        text: '',
        steps: [
          {
            toolCalls: [
              { toolName: 'web_search' },
              { toolName: 'web_search' },
              { toolName: 'some_other_tool' },
            ],
          },
          { toolCalls: [{ toolName: 'web_search' }] },
        ],
        usage: baseUsage,
      } as unknown as Awaited<ReturnType<typeof generateText>>);

      const result = await service.executeAgent({
        agent: buildAgent(),
        userPrompt: 'test',
        workspaceId,
      });

      const expectedSearchCost = 3 * NATIVE_WEB_SEARCH_COST_PER_CALL_DOLLARS;

      expect(result.nativeWebSearchCallCount).toBe(3);
      expect(result.totalCostInDollars).toBeCloseTo(
        0.01 + expectedSearchCost,
        6,
      );
      expect(result.creditsUsedMicro).toBe(
        Math.round((0.01 + expectedSearchCost) * 1_000_000),
      );
    });
  });
});
