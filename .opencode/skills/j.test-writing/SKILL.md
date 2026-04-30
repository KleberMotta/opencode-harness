---
name: j.test-writing
description: Write focused unit and integration tests following project conventions
# Optional: uncomment to enable Playwright MCP for E2E tests
# mcp:
#   playwright:
#     command: npx
#     args: ["-y", "@playwright/mcp@latest"]
---

# Skill: Test Writing

## When this skill activates
Writing or editing `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` files.

## Required Steps

### 1. Read the implementation first
Before writing any test, read the file being tested. Understand:
- What it does (not what you think it does)
- Its dependencies and side effects
- Error cases and edge conditions

### 2. Test structure
Follow the AAA pattern strictly:
```typescript
describe("ComponentName / functionName", () => {
  describe("when <condition>", () => {
    it("should <expected behavior>", () => {
      // Arrange
      const input = ...

      // Act
      const result = ...

      // Assert
      expect(result).toBe(...)
    })
  })
})
```

### 3. Coverage requirements
- Happy path: at least 1 test
- Error cases: test each distinct error path
- Edge cases: empty inputs, boundary values, null/undefined
- Prefer tests related to the changed files before running the full suite
- Do NOT test implementation details — test behavior

### 4. Mock strategy
- Mock external dependencies (APIs, DB, file system)
- Do NOT mock the module under test
- Use `vi.mock()` or `jest.mock()` for module mocking
- Use `vi.spyOn()` for method spying

### 5. Async tests
Always use `async/await`:
```typescript
it("should handle async operation", async () => {
  const result = await myAsyncFunction()
  expect(result).toEqual(expected)
})
```

### 6. Naming conventions
- Describe block: noun (component/function name)
- Nested describe: "when <condition>"
- It block: "should <verb> <outcome>"
- Test file: `{module}.test.ts` co-located with source

## Anti-patterns to avoid
- `expect(true).toBe(true)` — meaningless assertion
- Snapshot tests for logic — use specific assertions
- Testing private methods directly
- `expect.assertions(0)` — always assert something
- Tests that depend on order of execution

---

## Kotlin / JUnit 5 / Mockito-Kotlin (TRP Services)

### Structure — Org Standard

```kotlin
@ExtendWith(SpringExtension::class)
class FooServiceTest {

  @InjectMocks private lateinit var service: FooService
  @Mock private lateinit var repository: FooRepository
  @Mock private lateinit var messagingService: MessagingService

  @AfterEach
  fun after() {
    verifyNoMoreInteractions(repository, messagingService)
  }

  @Test
  fun `should do X when Y`() {
    // given
    whenever(repository.findById(id)).thenReturn(Optional.of(entity))

    // when
    service.execute(id)

    // then
    verify(repository).findById(id)
    verify(repository).save(any())
    verify(messagingService).sendEvent(any(), eq(EventType.FOO))
  }
}
```

### Mandatory Rules

1. **Class annotations**: `@ExtendWith(SpringExtension::class)` — no `@SpringBootTest`.
2. **Mock declarations**: `@Mock private lateinit var` for every dependency.
3. **Service under test**: `@InjectMocks private lateinit var service: TargetService`.
4. **`@AfterEach` verification**: `verifyNoMoreInteractions(...)` listing ALL `@Mock` fields. This catches unexpected interactions that silently pass.
5. **Stubbing**: use `whenever(...).thenReturn(...)` (Mockito-Kotlin). `given(...)` (BDDMockito) is also acceptable.
6. **Verify all mock interactions**: every test must `verify(mock).method(...)` for each expected call AND rely on `verifyNoMoreInteractions` to catch unverified calls. Include `verify(repo).findById(...)` even on exception paths.
7. **Assert with captors**: use `argumentCaptor<Type>()` to capture and assert on saved entities, published events, and messages.
8. **Never-called verification**: `verify(mock, never()).method(any())` for paths that must NOT trigger side effects.
9. **Helpers as private functions**: factory methods like `pendingEntity()`, `approvedRequest()` at the bottom of the class.
10. **No inline `mock()`**: Do NOT use `val repo: FooRepo = mock()` — always use `@Mock lateinit var`.

### Import Checklist

```kotlin
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.mockito.InjectMocks
import org.mockito.Mock
import org.mockito.kotlin.any
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.eq
import org.mockito.kotlin.never
import org.mockito.kotlin.verify
import org.mockito.kotlin.verifyNoMoreInteractions
import org.mockito.kotlin.whenever
import org.springframework.test.context.junit.jupiter.SpringExtension
```

### Anti-patterns (Kotlin)

- Using `mock()` inline construction instead of `@Mock lateinit var`
- Missing `@AfterEach verifyNoMoreInteractions(...)` — allows silent unexpected calls
- Not verifying `findById()` / lookup calls in exception test paths
- Stubbing in `@BeforeEach` when only 2-3 tests need it — prefer per-test stubs
- Using `@SpringBootTest` for unit tests — too heavy, use `@ExtendWith(SpringExtension::class)`

---

## Kotlin Controller Integration Tests (TRP Services)

### Structure — Org Standard

Controller tests extend `AbstractControllerTest` which provides `MockMvc`, `ObjectMapper`, and `performPost/Get/Put/Patch/Delete` helpers.

```kotlin
class FooEventControllerTest : AbstractControllerTest() {

  private val faker = faker()

  @MockitoBean private lateinit var fooService: FooService

  companion object {
    private const val BASE_URL = "/v1/events/foo"
  }

  @Test
  fun `should return 204 when event processed`() {
    // given
    val id = faker.random.randomString(10)
    val request = FooEventRequest(field = "value")
    willDoNothing().given(fooService).process(any(), any())

    // when / then
    performPost("$BASE_URL/$id/action", request).andExpect(status().isNoContent)
  }

  @Test
  fun `should return 404 when entity not found`() {
    // given
    val id = faker.random.randomString(10)
    val request = FooEventRequest(field = "value")
    given(fooService.process(any(), any())).willThrow(EntityNotFoundException("..."))

    // when / then
    performPost("$BASE_URL/$id/action", request).andExpect(status().isNotFound)
  }

  @Test
  fun `should return 400 when required field is blank`() {
    // given
    val id = faker.random.randomString(10)
    val request = FooEventRequest(field = "")

    // when / then
    performPost("$BASE_URL/$id/action", request).andExpect(status().is4xxClientError)
    verifyNoInteractions(fooService)
  }
}
```

### Mandatory Rules (Controller Tests)

1. **Base class**: Always extend `AbstractControllerTest()` — provides `mockMvc`, `mapper`, and `performPost/Get/Put/Patch/Delete(url, body?, headers?)` helpers.
2. **Annotations**: None beyond what the base class provides (`@SpringBootTest`, `@AutoConfigureMockMvc`, `@ActiveProfiles("test")`). Do NOT add `@WebMvcTest`.
3. **Service mocking**: `@MockitoBean private lateinit var` for domain services. NOT `@Mock` — must be Spring-managed. NEVER use deprecated `@MockBean` from `org.springframework.boot.test.mock.mockito` — always use `@MockitoBean` from `org.springframework.test.context.bean.override.mockito`.
4. **Stubbing style**: BDDMockito — `willDoNothing().given(service).method(...)` for void, `given(service.method(...)).willReturn(...)` for non-void, `given(service.method(...)).willThrow(...)` for errors.
5. **Request construction**: Build typed request DTOs inline. Use file fixtures (`FileUtil.loadController(path)`) only when payloads are large/complex.
6. **Assertions**: Chain on the `performPost(...)` result — `.andExpect(status().isNoContent)`, `.andExpect(status().isNotFound)`, etc.
7. **Validation tests**: Pass invalid DTOs (blank required fields, null mandatory fields), assert `status().is4xxClientError`, then `verifyNoInteractions(service)` to prove the request never reached the service.
8. **No `@AfterEach`**: Controller tests do NOT use `verifyNoMoreInteractions` — the base class and Spring context handle lifecycle.
9. **No auth assertions**: Security is not tested at this level in this org.
10. **`companion object`**: Define `BASE_URL` constant in companion.
11. **Faker**: Use `private val faker = faker()` for random IDs.

### Import Checklist (Controller Tests)

```kotlin
import br.com.olx.trp.financial.controller.AbstractControllerTest // or project-local equivalent
import br.com.olx.trp.financial.util.faker // or project-local equivalent
import org.junit.jupiter.api.Test
import org.mockito.BDDMockito.given
import org.mockito.BDDMockito.willDoNothing
import org.mockito.kotlin.any
import org.mockito.kotlin.verifyNoInteractions
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status
```

### AbstractControllerTest Contract

The base class must provide:
- `protected lateinit var mockMvc: MockMvc` (autowired)
- `protected lateinit var mapper: ObjectMapper` (autowired)
- `fun performPost(url: String, param: Any?, headers: Map<String, String>? = null): ResultActions`
- `fun performGet(url: String, headers: Map<String, String>? = null): ResultActions`
- `fun performPut(url: String, param: Any?, headers: Map<String, String>? = null): ResultActions`
- `fun performPatch(url: String, param: Any?, headers: Map<String, String>? = null): ResultActions`
- `fun performDelete(url: String, headers: Map<String, String>? = null): ResultActions`
- `fun <T> map(responseAsString: String, clazz: Class<T>): T`

If the project doesn't have `AbstractControllerTest`, create one following this contract.

### Anti-patterns (Controller Tests)

- Using `@WebMvcTest` instead of `@SpringBootTest + @AutoConfigureMockMvc`
- Using `@Mock` instead of `@MockitoBean` for service dependencies
- Using deprecated `@MockBean` (`org.springframework.boot.test.mock.mockito.MockBean`) — always use `@MockitoBean` (`org.springframework.test.context.bean.override.mockito.MockitoBean`)
- Using raw `mockMvc.perform(...)` instead of base class helpers
- Testing auth/roles at controller level (not done in this org)
- Using `@Sql` fixtures in unit-style controller tests (reserve for endpoint/integration tests)
- Writing `verifyNoMoreInteractions` in controller tests — unnecessary with MockitoBean lifecycle
