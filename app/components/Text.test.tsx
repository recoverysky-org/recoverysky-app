import { NavigationContainer } from "@react-navigation/native"
import { render } from "@testing-library/react-native"

import { Text } from "./Text"
import { ThemeProvider } from "../theme/context"

/* This is a React Native component test using jest-expo and @testing-library/react-native.
 * Run with: npm run test:component
 * For more information, see: https://callstack.github.io/react-native-testing-library/ */
const testText = "Test string"

describe("Text", () => {
  it("should render the component", () => {
    const { getByText } = render(
      <ThemeProvider>
        <NavigationContainer>
          <Text text={testText} />
        </NavigationContainer>
      </ThemeProvider>,
    )
    expect(getByText(testText)).toBeDefined()
  })
})
