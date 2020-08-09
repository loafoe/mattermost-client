jest.mock('request');
const requestMock = require('request');
const Client = require('./client');

test('should login to mattermost', () => {
    const tested = new Client('test.foo.bar/', 'dummy', {});
    tested.login('obiwan.kenobi@jedi.org', 'password', null);
    expect(requestMock).toHaveBeenCalledWith({
           headers: expect.objectContaining({
             "Content-Type": "application/json",
             "X-Requested-With": "XMLHttpRequest",
           }),
           json: {
             "login_id": "obiwan.kenobi@jedi.org",
             "password": "password",
             "token": null,
           },
           method: "POST",
           rejectUnauthorized: true,
           uri: "https://test.foo.bar//api/v4/users/login",
         }, expect.anything());
});