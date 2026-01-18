from arcadepy import Arcade
 
# You can also set the `ARCADE_API_KEY` environment variable instead of passing it as a parameter.
client = Arcade(api_key="{arcade_api_key}")
 
# Arcade needs a unique identifier for your application user (this could be an email address, a UUID, etc).
# In this example, use the email you used to sign up for Arcade.dev:
user_id = "danieltwentytwo@gmail.com"
 
 
# Helper function to authorize and run any tool
def authorize_and_run_tool(tool_name, input, user_id):
    # Start the authorization process
    auth_response = client.tools.authorize(
        tool_name=tool_name,
        user_id=user_id,
    )
 
    # If the authorization is not completed, print the authorization URL and wait for the user to authorize the app.
    # Tools that do not require authorization will have the status "completed" already.
    if auth_response.status != "completed":
        print(f"Click this link to authorize {tool_name}: {auth_response.url}. The process will continue once you have authorized the app.")
        if auth_response.id:
            client.auth.wait_for_completion(auth_response.id)

    # Run the tool
    return client.tools.execute(tool_name=tool_name, input=input, user_id=user_id)
 
# This tool does not require authorization, so it will return the results
# without prompting the user to authorize the tool call.
response_search = authorize_and_run_tool(
    tool_name="GoogleNews.SearchNewsStories",
    input={
        "keywords": "MCP URL mode elicitation",
    },
    user_id=user_id,
)
 
# Get the news results from the response
news = getattr(getattr(response_search, "output", None), "value", {}).get("news_results", [])

# Format the news results into a string
output = "latest news about MCP URL mode elicitation:\n"
for search_result in news:
    output += "----------------------------\n"
    output += f"{search_result['source']} - {search_result['title']}\n"
    output += f"{search_result['link']}\n"
 
# Create a Google Doc with the news results
# If the user has not previously authorized the Google Docs tool, they will be prompted to authorize the tool call.
response_create_doc = authorize_and_run_tool(
    tool_name="GoogleDocs.CreateDocumentFromText",
    input={
        "title": "News about MCP URL mode elicitation",
        "text_content": output,
    },
    user_id=user_id,
)
 
# Get the Google Doc from the response
google_doc = getattr(getattr(response_create_doc, "output", None), "value", {})

email_body = f"You can find the news about MCP URL mode elicitation in the following Google Doc: {google_doc.get('documentUrl')}"
 
# Send an email with the link to the Google Doc
response_send_email = authorize_and_run_tool(
    tool_name="Gmail.SendEmail",
    input={
        "recipient": user_id,
        "subject": "News about MCP URL mode elicitation",
        "body": email_body,
    },
    user_id=user_id,
)
 
# Print the response from the tool call
print(f"Success! Check your email at {user_id}\n\nYou just chained 3 tools together:\n  1. Searched Google News for stories about MCP URL mode elicitation\n  2. Created a Google Doc with the results\n  3. Sent yourself an email with the document link\n\nEmail metadata:")
print(getattr(getattr(response_send_email, "output", None), "value", {}))